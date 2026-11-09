'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const AI = require('../shared/analysis-ai');

const PROVIDERS = {
  openai: { name: 'OpenAI', host: 'api.openai.com', endpoint: '/v1/responses', defaultModel: 'gpt-4.1-mini' },
  anthropic: { name: 'Anthropic', host: 'api.anthropic.com', endpoint: '/v1/messages', defaultModel: 'claude-haiku-4-5-20251001' },
};
const MAX_OUTPUT_TOKENS = 1500;

function providerSpec(provider) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Choose OpenAI or Anthropic.');
  return PROVIDERS[provider];
}

function validateModel(provider, model) {
  providerSpec(provider);
  if (typeof model !== 'string' || model.length > 100 ||
      !(provider === 'openai' ? /^gpt-[a-z0-9.-]+$/ : /^claude-[a-z0-9-]+$/).test(model)) {
    throw new Error('Enter a valid model ID for the selected provider.');
  }
  return model;
}

class CloudAccounts {
  constructor(file, safeStorage) {
    this.file = file;
    this.safeStorage = safeStorage;
  }

  protectedStorage() {
    return this.safeStorage.isEncryptionAvailable() &&
      this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  }

  read() {
    let value;
    try { value = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('Cloud provider settings could not be read. Restore the encrypted provider file or remove it before reconnecting.');
    }
    if (!value || Array.isArray(value) || typeof value !== 'object' ||
        Object.keys(value).some(k => !Object.hasOwn(PROVIDERS, k))) throw new Error('Invalid cloud provider settings.');
    for (const [provider, entry] of Object.entries(value)) {
      validateModel(provider, entry?.model);
      if (typeof entry.encryptedKey !== 'string' || entry.encryptedKey.length > 8192 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.encryptedKey)) throw new Error('Invalid encrypted cloud credential.');
    }
    return value;
  }

  status() {
    const data = this.read();
    return {
      providers: Object.entries(PROVIDERS).map(([id, spec]) => ({
        id, name: spec.name, model: data[id]?.model || spec.defaultModel, configured: !!data[id],
      })),
    };
  }

  models() {
    const data = this.read();
    return Object.entries(data).map(([id, entry]) => ({
      id: `cloud:${id}`, runtime: 'cloud', provider: id, model: entry.model,
      cloud: true, label: `${PROVIDERS[id].name} / ${entry.model} (cloud)`,
    }));
  }

  save({ provider, model, key }) {
    validateModel(provider, model);
    if (!this.protectedStorage()) throw new Error('OS-protected credential storage is unavailable. Cloud providers cannot be enabled.');
    if (typeof key !== 'string') throw new Error('Enter an API key, or leave it blank to keep the saved key.');
    const data = this.read();
    if (!key && !data[provider]) throw new Error('Enter your provider API key. Chat subscription credentials are not supported.');
    if (key && (!/^sk-[A-Za-z0-9_-]{10,400}$/.test(key) ||
        (provider === 'anthropic' && !key.startsWith('sk-ant-')))) throw new Error('Enter a valid API key for the selected provider.');
    data[provider] = {
      model,
      encryptedKey: key ? this.safeStorage.encryptString(key).toString('base64') : data[provider].encryptedKey,
    };
    this.write(data);
    return this.status();
  }

  disconnect(provider) {
    providerSpec(provider);
    const data = this.read();
    delete data[provider];
    if (!Object.keys(data).length) {
      try { fs.unlinkSync(this.file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else this.write(data);
    return this.status();
  }

  write(data) {
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, this.file);
    } finally {
      try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  credential(provider, model) {
    if (!this.protectedStorage()) throw new Error('OS-protected credential storage is unavailable.');
    const entry = this.read()[provider];
    if (!entry || entry.model !== model) throw new Error('Cloud provider configuration changed. Choose the provider again.');
    try { return this.safeStorage.decryptString(Buffer.from(entry.encryptedKey, 'base64')); }
    catch { throw new Error('The saved API key cannot be unlocked on this device. Reconnect the provider.'); }
  }
}

function cloudSchema(schema) {
  // Provider structured-output APIs do not all support numeric/string bounds. Enforce them locally.
  return {
    ...schema,
    properties: Object.fromEntries(Object.entries(schema.properties).map(([key, rule]) => {
      const { minimum, maximum, maxLength, ...rest } = rule;
      const bounds = minimum !== undefined ? `Value must be between ${minimum} and ${maximum}.` :
        maxLength !== undefined ? `At most ${maxLength} characters.` : '';
      return [key, { ...rest, description: [rest.description, bounds].filter(Boolean).join(' ') }];
    })),
  };
}

function requestBody(provider, model, prompt, schema) {
  validateModel(provider, model);
  const format = { type: 'json_schema', schema: cloudSchema(schema) };
  if (provider === 'openai') return {
    model, store: false, max_output_tokens: MAX_OUTPUT_TOKENS,
    instructions: AI.INSTRUCTIONS, input: prompt,
    text: { format: { ...format, name: 'analytics_query', strict: true } },
  };
  return {
    model, max_tokens: MAX_OUTPUT_TOKENS, system: AI.INSTRUCTIONS,
    messages: [{ role: 'user', content: prompt }], output_config: { format },
  };
}

function cloudJson(provider, key, body, signal) {
  const spec = providerSpec(provider);
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (provider === 'openai') headers.Authorization = `Bearer ${key}`;
    else Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2026-10-21' });
    const request = https.request({
      hostname: spec.host, port: 443, path: spec.endpoint, method: 'POST', headers, signal,
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        const hint = response.statusCode === 401 || response.statusCode === 403 ? 'Check your API key and account permissions.' :
          response.statusCode === 429 ? 'Check provider rate limits, credits and billing.' :
            response.statusCode === 400 || response.statusCode === 404 ? 'Check that this model supports structured output and your account has access.' :
              'The provider could not complete this request.';
        reject(new Error(`${spec.name} returned HTTP ${response.statusCode}. ${hint} No retry or fallback was attempted.`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) request.destroy(new Error('Cloud model response is too large.'));
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new Error(`${spec.name} response was interrupted.`)));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error(`${spec.name} returned invalid JSON.`)); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('Cloud request timed out.')), 120000);
    request.on('close', () => clearTimeout(timer));
    // Never forward raw network/provider error text: it may contain credentials or request data.
    request.on('error', () => reject(new Error(signal?.aborted ? 'Cloud request cancelled.' :
      `${spec.name} connection failed or timed out. No retry was attempted.`)));
    request.end(data);
  });
}

function parseResponse(provider, response) {
  let text;
  if (provider === 'openai') {
    if (response?.status !== 'completed') throw new Error('OpenAI did not complete the query. Output limit or provider refusal may have been reached.');
    if (!Array.isArray(response.output)) throw new Error('OpenAI returned an invalid response.');
    const blocks = response.output.filter(item => item?.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content : []);
    if (blocks.some(block => !block || typeof block !== 'object')) throw new Error('OpenAI returned an invalid response.');
    if (blocks.some(block => block.type === 'refusal')) throw new Error('OpenAI declined this request.');
    text = blocks.filter(block => block.type === 'output_text').map(block => block.text).join('');
  } else {
    if (response?.stop_reason !== 'end_turn') throw new Error('Anthropic did not complete the query. Output limit or provider refusal may have been reached.');
    if (!Array.isArray(response.content)) throw new Error('Anthropic returned an invalid response.');
    text = response.content.filter(block => block?.type === 'text').map(block => block.text).join('');
  }
  let plan;
  try { plan = JSON.parse(text); } catch { throw new Error('The cloud model returned an invalid query.'); }
  const usage = response.usage || {};
  const inputTokens = usage.input_tokens, outputTokens = usage.output_tokens;
  return {
    plan,
    usage: Number.isSafeInteger(inputTokens) && inputTokens >= 0 && Number.isSafeInteger(outputTokens) && outputTokens >= 0 ?
      { inputTokens, outputTokens } : null,
  };
}

class CloudAI {
  constructor({ accounts, confirm, request = cloudJson }) {
    this.accounts = accounts;
    this.confirm = confirm;
    this.request = request;
  }

  models() { return this.accounts.models(); }

  async query(model, prompt, schema, signal, connectionCheck = false) {
    const spec = providerSpec(model.provider);
    const accepted = await this.confirm({
      title: connectionCheck ? 'Check cloud provider connection' : 'Send analytics question to cloud',
      message: `${connectionCheck ? 'Send a synthetic connection test' : 'Send this question'} to ${spec.name}?`,
      detail: `Model: ${model.model}\nThis uses your API account, not your chat subscription. API charges may apply, even if you cancel after sending. ` +
        `Output is capped at ${MAX_OUTPUT_TOKENS} tokens; no automatic retry or fallback. Prices depend on your provider and model; no reliable cost estimate is available in AMP22.\n\n` +
        (connectionCheck ? 'Only a synthetic test and its schema will be sent; no game data.\n\n' :
          'The question, game/week scope, team/side, filter description, personnel labels and the named player name/ID/side will leave this device. No raw play rows, computed results or film are sent. Provider retention policies apply.\n\n') +
        `Exact question/context payload:\n${prompt}`,
    });
    signal.throwIfAborted();
    if (!accepted) throw new Error('Cloud request cancelled before sending.');
    const key = this.accounts.credential(model.provider, model.model);
    const response = await this.request(model.provider, key, requestBody(model.provider, model.model, prompt, schema), signal);
    signal.throwIfAborted();
    return parseResponse(model.provider, response);
  }
}

module.exports = { CloudAccounts, CloudAI, PROVIDERS, cloudJson, cloudSchema, requestBody, parseResponse };
