'use strict';

const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const AI = require('../shared/analysis-ai');
const { CloudAccounts, CloudAI } = require('./cloud-ai');
const { saveReport } = require('./reports');

const RUNTIMES = { ollama: { port: 11434, name: 'Ollama' } };
const MAX_RESPONSE = 2 * 1024 * 1024;

function localJson(runtime, endpoint, body, signal, timeout = 3000) {
  if (!RUNTIMES[runtime] || !endpoint.startsWith('/')) throw new Error('Invalid local model endpoint.');
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1', port: RUNTIMES[runtime].port, path: endpoint,
      method: data === null ? 'GET' : 'POST', signal,
      headers: data === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`${RUNTIMES[runtime].name} returned HTTP ${response.statusCode}; redirects and remote servers are not allowed.`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE) request.destroy(new Error('Local model response is too large.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error(`${RUNTIMES[runtime].name} returned invalid JSON.`)); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error(`${RUNTIMES[runtime].name} request timed out.`)), timeout);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    request.end(data);
  });
}

function hasRemoteMetadata(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, v]) =>
    (/remote|cloud/i.test(key) && !!v) || (typeof v === 'object' && hasRemoteMetadata(v)));
}

function localOllama(tag, detail) {
  return typeof tag?.name === 'string' && tag.name.length <= 200 && !/cloud/i.test(tag.name) &&
    tag.size > 1000000 && /^[a-f0-9]{64}$/i.test(tag.digest || '') &&
    !hasRemoteMetadata(tag) && !hasRemoteMetadata(detail) &&
    detail?.details?.format === 'gguf' && !!detail.model_info?.['general.architecture'] &&
    detail.capabilities?.includes('completion') && detail.capabilities.includes('tools');
}

function nativeRequest(binary, check, body, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, check ? ['--check'] : [], { stdio: ['pipe', 'pipe', 'pipe'], signal });
    const chunks = [];
    let bytes = 0;
    let failure;
    const timer = setTimeout(() => {
      failure = new Error('Apple on-device model request timed out.');
      child.kill();
    }, check ? 5000 : 120000);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_RESPONSE) {
        failure = new Error('Apple model response is too large.');
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (code !== 0 || value.error) throw new Error(value.error || 'Apple on-device model request failed.');
        resolve(value);
      } catch (error) { reject(error); }
    });
    child.stdin.end(body ? JSON.stringify(body) : undefined);
  });
}

class AnalyticsAI {
  constructor({ platform = process.platform, arch = process.arch, release = os.release(),
    packaged = false, resourcesPath = process.resourcesPath, request = localJson,
    native = nativeRequest, exists = fs.existsSync, log = console.warn, cloud = null } = {}) {
    this.platform = platform;
    this.apple = platform === 'darwin' && arch === 'arm64' && Number(release.split('.')[0]) >= 25;
    this.binary = packaged ? path.join(resourcesPath, 'native', 'amp22-foundation-models') :
      path.join(__dirname, '../../build/native/amp22-foundation-models');
    this.request = request;
    this.native = native;
    this.exists = exists;
    this.log = log;
    this.models = [];
    this.running = null;
    this.cloud = cloud;
  }

  async discover(signal) {
    if (this.running) return this.models;
    const local = await this.discoverLocal(signal);
    let cloud = [];
    if (this.cloud) {
      try { cloud = this.cloud.models(); }
      catch (error) { this.log(`Cloud AI configuration: ${error.message}`); }
    }
    return this.models = [...local, ...cloud];
  }

  async discoverLocal(signal) {
    if (this.apple) {
      if (!this.exists(this.binary)) {
        this.log('Analytics AI: Apple helper is missing; build it with npm run build:ai.');
        return this.models = [];
      }
      try {
        const status = await this.native(this.binary, true, null, signal);
        return this.models = status.available === true ?
          [{ id: 'apple', runtime: 'apple', label: 'Apple on-device model' }] : [];
      } catch (error) {
        if (signal?.aborted) throw error;
        this.log(`Analytics AI discovery: ${error.message}`);
        return this.models = [];
      }
    }
    if (this.platform !== 'win32') return this.models = [];
    const results = await Promise.all(Object.keys(RUNTIMES).map(async runtime => {
      try { return await this.runtimeModels(runtime, signal); }
      catch (error) {
        if (signal?.aborted) throw error;
        if (error.code !== 'ECONNREFUSED') this.log(`Analytics AI discovery: ${error.message}`);
        return [];
      }
    }));
    return this.models = results.flat();
  }

  async runtimeModels(runtime, signal) {
    const tags = await this.request(runtime, '/api/tags', undefined, signal);
    if (!Array.isArray(tags?.models)) throw new Error('Ollama model metadata is unavailable.');
    const candidates = tags.models.filter(t => typeof t.name === 'string' && t.name.length > 0 &&
      t.name.length <= 200 && !/cloud/i.test(t.name) && !hasRemoteMetadata(t) && t.size > 1000000);
    const models = [];
    for (let i = 0; i < candidates.length && models.length < 10; i += 4) {
      const batch = await Promise.all(candidates.slice(i, i + 4).map(async tag => {
        try {
          const detail = await this.request(runtime, '/api/show', { model: tag.name }, signal);
          return localOllama(tag, detail) ? {
            id: `ollama:${tag.name}`, runtime, model: tag.name, label: `Ollama / ${tag.name}`, digest: tag.digest,
          } : null;
        } catch (error) {
          if (signal?.aborted) throw error;
          this.log(`Analytics AI model metadata: ${error.message}`);
          return null;
        }
      }));
      models.push(...batch.filter(Boolean));
    }
    return models.slice(0, 10);
  }

  async plan(request) {
    if (this.running) throw new Error('An analytics question is already running.');
    if (!request || typeof request.provider !== 'string') throw new Error('Choose an available model.');
    const model = this.models.find(m => m.id === request.provider);
    if (!model) throw new Error('This model is no longer available. Reopen Analysis Lab to check again.');
    const labels = AI.validateCatalog(request.catalog);
    const context = request.context;
    if (!context || !['offense', 'defense'].includes(context.side) || typeof context.scope !== 'string' ||
        context.scope.length > 1000 || typeof context.filters !== 'string' || context.filters.length > 4000 ||
        !Number.isInteger(context.snaps) || context.snaps < 0 || context.snaps > 20000 ||
        typeof context.team !== 'string' || !/^[A-Z]{2,3}$/.test(context.team)) throw new Error('Invalid analytics context.');
    const permittedLabels = AI.queryCatalog(request.question, labels);
    const prompt = AI.prompt(request.question, context, { ...labels, players: permittedLabels.players });
    const schema = AI.querySchema(request.question, permittedLabels);
    const controller = new AbortController();
    this.running = controller;
    try {
      let plan;
      let usage;
      if (model.runtime === 'cloud') {
        const response = await this.cloud.query(model, prompt, schema, controller.signal);
        plan = response.plan;
        usage = response.usage;
      } else if (model.runtime === 'apple') {
        plan = await this.native(this.binary, false, { instructions: AI.INSTRUCTIONS, prompt, schema }, controller.signal);
      } else {
        // Recheck native metadata immediately before inference, including Ollama's weight digest.
        const current = await this.runtimeModels(model.runtime, controller.signal);
        if (!current.some(m => m.id === model.id && m.digest === model.digest)) {
          throw new Error('The selected model changed or is no longer verified local. Reopen Analysis Lab.');
        }
        const response = await this.request(model.runtime, '/v1/chat/completions', {
          model: model.model, stream: false, temperature: 0, max_tokens: 1500,
          messages: [{ role: 'system', content: AI.INSTRUCTIONS }, { role: 'user', content: prompt }],
          response_format: { type: 'json_schema', json_schema: { name: 'analytics_query', strict: true, schema } },
        }, controller.signal, 120000);
        const content = response?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('The local model did not return a query.');
        try { plan = JSON.parse(content); }
        catch { throw new Error('The local model returned an invalid query. Use a model supporting structured output.'); }
      }
      controller.signal.throwIfAborted();
      const validated = AI.validatePlan(plan, permittedLabels, schema);
      return model.runtime === 'cloud' ? { plan: validated, usage, provider: model.label } : validated;
    } finally { this.running = null; }
  }

  cancel() { this.running?.abort(); }

  async checkCloud(provider) {
    if (this.running) throw new Error('Finish or cancel the current question before checking a provider.');
    const model = this.cloud.models().find(m => m.provider === provider);
    if (!model) throw new Error('Save the provider API key and model before checking its connection.');
    const labels = { offense: ['all'], defense: ['all'] };
    const prompt = AI.prompt('What was overall yards per play?', {
      team: 'BAL', side: 'offense', scope: 'Synthetic connection test, not game data', filters: 'None', snaps: 1,
    }, labels);
    const controller = new AbortController();
    this.running = controller;
    try {
      const response = await this.cloud.query(model, prompt, AI.schema(labels), controller.signal, true);
      AI.validatePlan(response.plan, labels);
      if (response.plan.status !== 'ok' || response.plan.group !== 'all' ||
          response.plan.split !== 'none' || response.plan.metric !== 'ypp') {
        throw new Error('The connection responded, but the model did not interpret the synthetic query correctly. Choose another model.');
      }
      return { provider: model.label, usage: response.usage };
    } finally { this.running = null; }
  }
}

function registerAnalyticsAI({ ipcMain, app, getWindow, dialog, safeStorage, clipboard }) {
  const accounts = safeStorage ? new CloudAccounts(path.join(app.getPath('userData'), 'cloud-providers.json'), safeStorage) : null;
  const cloud = accounts ? new CloudAI({
    accounts,
    confirm: async options => {
      const result = await dialog.showMessageBox(getWindow(), {
        ...options, type: 'question', buttons: ['Cancel', 'Send to provider'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return result.response === 1;
    },
  }) : null;
  const service = new AnalyticsAI({ packaged: app.isPackaged, cloud });
  const authorize = event => {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Analytics questions are only available in the main AMP22 window.');
    }
  };
  ipcMain.handle('analysis-ai:discover', async event => {
    authorize(event);
    return (await service.discover()).map(({ id, label, cloud }) => ({ id, label, cloud: cloud === true }));
  });
  ipcMain.handle('analysis-ai:plan', (event, request) => { authorize(event); return service.plan(request); });
  ipcMain.handle('analysis-ai:cancel', event => { authorize(event); service.cancel(); });
  ipcMain.handle('analysis-ai:cloud-status', event => { authorize(event); return accounts.status(); });
  const changeAccount = (event, action) => {
    authorize(event);
    if (service.running) throw new Error('Finish or cancel the current question before changing cloud providers.');
    const result = action();
    service.models = [];
    return result;
  };
  ipcMain.handle('analysis-ai:cloud-save', (event, request) => changeAccount(event, () => accounts.save(request)));
  ipcMain.handle('analysis-ai:cloud-disconnect', (event, provider) => changeAccount(event, () => accounts.disconnect(provider)));
  ipcMain.handle('analysis-ai:cloud-check', (event, provider) => { authorize(event); return service.checkCloud(provider); });
  ipcMain.handle('analysis-ai:handoff', async (event, request) => {
    authorize(event);
    if (!request || !['preview', 'copy', 'save'].includes(request.action)) throw new Error('Invalid analysis sharing action.');
    const text = AI.handoff(request.report, request.question);
    if (request.action === 'preview') return { text };
    if (request.action === 'copy') { clipboard.writeText(text); return { copied: true }; }
    const destination = await dialog.showSaveDialog(getWindow(), {
      title: 'Save analysis for external chat', defaultPath: path.join(app.getPath('downloads'), 'AMP22-analysis-context.txt'),
      filters: [{ name: 'Plain text', extensions: ['txt'] }],
    });
    if (destination.canceled) return { cancelled: true };
    const file = destination.filePath.toLowerCase().endsWith('.txt') ? destination.filePath : `${destination.filePath}.txt`;
    await saveReport(file, Buffer.from(text));
    return { saved: true };
  });
  app.on('before-quit', () => service.cancel());
}

module.exports = { AnalyticsAI, localJson, nativeRequest, localOllama, registerAnalyticsAI };
