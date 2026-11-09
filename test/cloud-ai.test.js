'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { CloudAccounts, CloudAI, cloudSchema, requestBody, parseResponse, cloudJson } = require('../src/main/cloud-ai');
const { AnalyticsAI, registerAnalyticsAI } = require('../src/main/analytics-ai');
const A = require('../src/shared/analysis');
const AI = require('../src/shared/analysis-ai');

const labels = { offense: ['all'], defense: ['all'] };
const plan = {
  status: 'ok', reason: '', group: 'all', split: 'none', metric: 'ypp', order: 'high',
  playType: 'all', down: 0, half: 'all', offense: 'all', defense: 'all', motion: 'all', playAction: 'all', minSnaps: 1, player: 'all', presence: 'all', downRange: 'all', minDistance: 0, maxDistance: 0,
};
const openai = query => ({
  status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(query) }] }],
  usage: { input_tokens: 100, output_tokens: 50 },
});
const anthropic = query => ({
  stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(query) }],
  usage: { input_tokens: 200, output_tokens: 40 },
});

function accounts(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-cloud-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let available = true, backend = 'keychain', failDecrypt = false;
  const keys = new Map();
  const storage = {
    isEncryptionAvailable: () => available, getSelectedStorageBackend: () => backend,
    encryptString: text => { const token = `sealed-${keys.size}`; keys.set(token, text); return Buffer.from(token); },
    decryptString: data => { if (failDecrypt) throw new Error('sensitive runtime error'); return keys.get(data.toString()); },
  };
  const vault = new CloudAccounts(path.join(folder, 'cloud-providers.json'), storage);
  return { vault, folder, storage, unavailable: () => { available = false; },
    basic: () => { backend = 'basic_text'; }, lock: () => { failDecrypt = true; } };
}

test('keys are encrypted, absent from public metadata, preserved on blank edit and removed on disconnect', t => {
  const { vault } = accounts(t);
  assert.equal(vault.status().providers.every(p => !p.configured), true);
  const key = 'sk-test-not-a-real-credential';
  const status = vault.save({ provider: 'openai', model: 'gpt-4.1-mini', key });
  assert.equal(status.providers[0].configured, true);
  assert.equal(fs.readFileSync(vault.file, 'utf8').includes(key), false);
  assert.equal(JSON.stringify(status).includes('encryptedKey'), false);
  assert.equal(JSON.stringify(vault.models()).includes('sealed'), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(vault.file).mode & 0o777, 0o600);
  vault.save({ provider: 'openai', model: 'gpt-4.1', key: '' });
  assert.equal(vault.credential('openai', 'gpt-4.1'), key);
  assert.throws(() => vault.credential('openai', 'gpt-4.1-mini'), /changed/);
  vault.save({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', key: 'sk-ant-test-not-a-real-credential' });
  vault.disconnect('openai');
  assert.deepEqual(vault.models().map(m => m.provider), ['anthropic']);
  vault.disconnect('anthropic');
  assert.equal(fs.existsSync(vault.file), false);
});

test('unprotected storage is rejected; corrupted and locked credentials fail explicitly', t => {
  const { vault, basic, lock } = accounts(t);
  assert.throws(() => vault.save({ provider: 'openai', model: 'gpt-4.1-mini', key: '' }), /Enter your/);
  assert.throws(() => vault.save({ provider: 'openai', model: 'https://other.test', key: 'sk-test-key' }), /model ID/);
  assert.throws(() => vault.save({ provider: 'custom', model: 'gpt-4.1-mini', key: 'sk-test-key' }), /Choose/);
  assert.throws(() => vault.save({ provider: 'anthropic', model: 'claude-haiku-4-5', key: 'sk-openai-test-key' }), /API key/);
  vault.save({ provider: 'openai', model: 'gpt-4.1-mini', key: 'sk-test-not-a-real-credential' });
  lock();
  assert.throws(() => vault.credential('openai', 'gpt-4.1-mini'), /cannot be unlocked/);
  basic();
  assert.equal(vault.models().length, 1, 'discovery reads saved configuration without unlocking it');
  assert.throws(() => vault.credential('openai', 'gpt-4.1-mini'), /OS-protected/);
  assert.throws(() => vault.save({ provider: 'openai', model: 'gpt-4.1-mini', key: '' }), /OS-protected/);
  vault.disconnect('openai');
  fs.writeFileSync(vault.file, 'broken');
  assert.throws(() => vault.status(), /could not be read/);
});

test('discovery and settings metadata never access OS credential storage', t => {
  const { vault } = accounts(t);
  vault.safeStorage = { isEncryptionAvailable: () => assert.fail('must not touch Keychain before a provider is configured') };
  assert.deepEqual(vault.models(), []);
  assert.equal(vault.status().providers.some(provider => provider.configured), false);
  fs.writeFileSync(vault.file, JSON.stringify({ openai: { model: 'gpt-4.1-mini', encryptedKey: 'ZW5jcnlwdGVk' } }));
  assert.equal(vault.models().length, 1);
  assert.equal(vault.status().providers[0].configured, true);
});

test('cloud adapters use provider-specific structured output, bounded tokens and no stored OpenAI response', () => {
  const original = AI.schema(labels);
  const simplified = cloudSchema(original);
  assert.equal(simplified.properties.down.minimum, undefined);
  assert.match(simplified.properties.down.description, /between 0 and 4/);
  assert.equal(original.properties.down.minimum, 0);
  const first = requestBody('openai', 'gpt-4.1-mini', 'compact prompt', original);
  assert.equal(first.store, false);
  assert.equal(first.max_output_tokens, 1500);
  assert.equal(first.text.format.strict, true);
  const second = requestBody('anthropic', 'claude-haiku-4-5-20251001', 'compact prompt', original);
  assert.equal(second.max_tokens, 1500);
  assert.equal(second.output_config.format.type, 'json_schema');
  assert.equal(second.messages[0].content, 'compact prompt');
  assert.deepEqual(parseResponse('openai', openai(plan)), { plan, usage: { inputTokens: 100, outputTokens: 50 } });
  assert.deepEqual(parseResponse('anthropic', anthropic(plan)), { plan, usage: { inputTokens: 200, outputTokens: 40 } });
  assert.throws(() => parseResponse('openai', { status: 'incomplete' }), /did not complete/);
  assert.throws(() => parseResponse('openai', { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), /declined/);
  assert.throws(() => parseResponse('anthropic', { stop_reason: 'max_tokens' }), /did not complete/);
  assert.throws(() => parseResponse('anthropic', { stop_reason: 'end_turn', content: [] }), /invalid query/);
  assert.throws(() => parseResponse('anthropic', { stop_reason: 'end_turn', content: {} }), /invalid response/);
  assert.throws(() => parseResponse('openai', { status: 'completed', output: {} }), /invalid response/);
  assert.throws(() => parseResponse('openai', { status: 'completed', output: [{ type: 'message', content: [null] }] }), /invalid response/);
});

test('each cloud query requires explicit consent before credentials or network are used', async () => {
  let accepted = false, network = 0, unlocked = 0;
  const cloud = new CloudAI({
    accounts: { credential: () => { unlocked++; return 'fake'; } },
    confirm: async options => {
      assert.match(options.detail, /Exact question\/context payload/);
      assert.match(options.detail, /No raw play rows/);
      assert.match(options.detail, /API charges/);
      return accepted;
    },
    request: async () => { network++; return openai(plan); },
  });
  const model = { provider: 'openai', model: 'gpt-4.1-mini' };
  await assert.rejects(cloud.query(model, 'scope payload', AI.schema(labels), new AbortController().signal), /before sending/);
  assert.equal(network, 0);
  assert.equal(unlocked, 0);
  accepted = true;
  assert.deepEqual((await cloud.query(model, 'scope payload', AI.schema(labels), new AbortController().signal)).plan, plan);
  assert.equal(network, 1);
  assert.equal(unlocked, 1);
});

test('cloud discovery makes no network calls, works without local hardware and never falls back', async t => {
  const { vault } = accounts(t);
  vault.save({ provider: 'openai', model: 'gpt-4.1-mini', key: 'sk-test-not-a-real-credential' });
  let network = 0;
  const cloud = new CloudAI({ accounts: vault, confirm: async () => true,
    request: async () => { network++; return openai(plan); } });
  const service = new AnalyticsAI({ platform: 'darwin', arch: 'x64', cloud,
    native: () => assert.fail('no native fallback'), request: () => assert.fail('no local fallback') });
  const models = await service.discover();
  assert.equal(network, 0);
  assert.equal(models[0].cloud, true);
  const response = await service.plan({ provider: models[0].id, question: 'Overall yards per play',
    catalog: labels, context: { team: 'BAL', side: 'defense', scope: '2024 Week 4', filters: 'None', snaps: 1 } });
  assert.deepEqual(response.plan, plan);
  assert.equal(response.usage.outputTokens, 50);
  assert.equal(network, 1);
  vault.disconnect('openai');
  await assert.rejects(service.plan({ provider: models[0].id, question: 'Overall yards per play',
    catalog: labels, context: { team: 'BAL', side: 'defense', scope: '2024 Week 4', filters: 'None', snaps: 1 } }), /configuration changed/);
  assert.equal(network, 1);
});

test('connection checks are synthetic, consented and validate model semantics', async t => {
  const { vault } = accounts(t);
  vault.save({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', key: 'sk-ant-test-not-a-real-credential' });
  let body;
  const cloud = new CloudAI({ accounts: vault, confirm: async options => {
    assert.match(options.detail, /Only a synthetic test/);
    return true;
  }, request: async (_provider, _key, value) => { body = value; return anthropic(plan); } });
  const service = new AnalyticsAI({ platform: 'linux', cloud });
  const result = await service.checkCloud('anthropic');
  assert.equal(result.usage.inputTokens, 200);
  assert.match(body.messages[0].content, /Synthetic connection test/);
  assert.equal(service.running, null);
});

test('cloud transport fixes hosts, never follows redirects or leaks provider error bodies', async t => {
  let status = 200;
  let payload = JSON.stringify(openai(plan));
  const seen = [];
  t.mock.method(https, 'request', (options, callback) => {
    seen.push(options);
    assert.equal(options.port, 443);
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = status;
      callback(response);
      response.end(payload);
      request.emit('close');
    });
    request.destroy = error => { request.emit('error', error); request.emit('close'); };
    return request;
  });
  await cloudJson('openai', 'fake-key', {}, new AbortController().signal);
  assert.equal(seen[0].hostname, 'api.openai.com');
  assert.equal(seen[0].path, '/v1/responses');
  assert.equal(seen[0].headers.Authorization, 'Bearer fake-key');
  status = 302; payload = '{"error":"fake-key leaked from upstream"}';
  await assert.rejects(cloudJson('anthropic', 'fake-key', {}, new AbortController().signal), error => {
    assert.match(error.message, /HTTP 302/);
    assert.equal(error.message.includes('fake-key'), false);
    return true;
  });
  assert.equal(seen[1].hostname, 'api.anthropic.com');
  assert.equal(seen[1].headers['x-api-key'], 'fake-key');
  assert.throws(() => cloudJson('custom', 'fake-key', {}, new AbortController().signal), /Choose/);
});

function report() {
  return {
    title: 'BAL defense', subtitle: '2024 Week 4 BUF at BAL', notes: 'Filters: Only selected plays; sources: nflverse',
    metric: 'epa', chart: 'bars', selection: { mode: 'include', playIds: ['2024_04_BUF_BAL/1'] },
    rows: A.summarize([{ gameId: '2024_04_BUF_BAL', playId: 1, playType: 'run', yards: 0, epa: null }]).rows
      .map(({ plays, ...r }) => r),
  };
}

test('external-chat handoff includes complete aggregates and provenance without raw plays', () => {
  const text = AI.handoff(report(), 'Explain this small sample.');
  assert.match(text, /Question: Explain this small sample/);
  assert.match(text, /Only selected plays/);
  assert.match(text, /"Selected game\/play ID","2024_04_BUF_BAL\/1"/);
  assert.match(text, /"Yards sample"/);
  assert.match(text, /not a significance threshold/);
  assert.equal(text.includes('"plays":'), false);
  assert.throws(() => AI.handoff(report(), 'x'.repeat(1001)), /1,000/);
  assert.throws(() => AI.handoff({ ...report(), rows: null }), /Invalid/);
});

test('handoff copy/save is main-frame restricted, preview-only by default and atomic on explicit save', async t => {
  const { folder, storage } = accounts(t);
  const handlers = new Map();
  const window = { webContents: { mainFrame: {} } };
  const app = new EventEmitter();
  app.getPath = () => folder;
  let copied = null, destination = { canceled: true };
  registerAnalyticsAI({
    app, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getWindow: () => window,
    safeStorage: storage, clipboard: { writeText: text => { copied = text; } },
    dialog: { showSaveDialog: async () => destination },
  });
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const handoff = handlers.get('analysis-ai:handoff');
  const result = await handoff(event, { action: 'preview', report: report(), question: '' });
  assert.match(result.text, /COMPUTED SUMMARY CSV/);
  assert.equal(copied, null);
  await handoff(event, { action: 'copy', report: report(), question: '' });
  assert.equal(copied, result.text);
  assert.deepEqual(await handoff(event, { action: 'save', report: report(), question: '' }), { cancelled: true });
  destination = { canceled: false, filePath: path.join(folder, 'context') };
  await handoff(event, { action: 'save', report: report(), question: '' });
  assert.equal(fs.readFileSync(destination.filePath + '.txt', 'utf8'), result.text);
  await assert.rejects(handoff({ sender: {}, senderFrame: {} }, { action: 'copy' }), /main AMP22/);
});
