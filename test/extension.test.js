'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schema = require('../src/shared/participation');
const collector = require('../extensions/nflpro/collector');
const url = 'https://pro.nfl.com/film/plays?season=2026&seasonType=REG&weekSlug=WEEK_9&gameId=source-game';
const source = (name) => fs.readFileSync(path.join(__dirname, '../extensions/nflpro', name), 'utf8');
const extensionVersion = JSON.parse(source('manifest.json')).version;
const play = (id) => ({ gameId: 2026110600, fapiGameId: 'source-game', playId: id,
  quarter: 1, gameClock: '10:21', down: 2, yardsToGo: 7, visitorTeamAbbr: 'BAL', homeTeamAbbr: 'BUF',
  playDescription: '(10:21) Synthetic test play' });
const expanded = () => ({
  homeIsOffense: false,
  home: Array.from({ length: 11 }, (_, i) => ({ gsisId: `00-${i + 1}`, playerName: `Fixture ${i}`, uniformNumber: i + 1, position: 'CB' })),
  away: Array.from({ length: 11 }, (_, i) => ({ gsisId: `00-${i + 12}`, playerName: `Fixture ${i}`, uniformNumber: i + 12, position: 'WR' })),
});
const chartingRequests = schema.CHARTING_FIELDS.reduce((count, field) => count + field.options.length, 0);
function page(get, chartingGet = async () => ({ count: 0, plays: [] })) {
  const messages = [], calls = [], delays = [];
  const window = {
    AMP22NFLCollector: collector, AMP22Participation: schema, addEventListener() {},
    $nuxt: { $store: { state: { film: { selectedPlay: play(99), plays: [play(99)] } } }, $api: { async $get(endpoint, options) {
      calls.push({ endpoint, options });
      if (schema.CHARTING_FIELDS.some(field => Object.hasOwn(options.params, field.query))) return chartingGet(endpoint, options);
      return get ? get(endpoint, options) : endpoint.endsWith('/plays') ? { count: 2, plays: [play(17), play(18)] } : expanded();
    } } },
    postMessage: (packet) => messages.push(packet),
  };
  const location = { href: url, origin: 'https://pro.nfl.com' };
  const context = vm.createContext({ window, location, URL, AbortController,
    setTimeout(fn, ms) { delays.push(ms); queueMicrotask(fn); } });
  vm.runInContext(source('page.js'), context);
  return { window, location, context, messages, calls, delays };
}
function content(download = async () => ({ supported: true, downloadId: 7 })) {
  const saved = {}, downloads = [], anchors = [];
  let receive, listen;
  const window = { postMessage() {}, addEventListener(_name, callback) { receive = callback; } };
  const chrome = { runtime: { id: 'extension', getManifest: () => ({ version: extensionVersion }),
    onMessage: { addListener(callback) { listen = callback; } },
    async sendMessage(message) { downloads.push(message); return download(message); },
  }, storage: { local: {
    async get(key) { return { [key]: saved[key] }; },
    async set(patch) { Object.assign(saved, patch); },
  } } };
  const context = vm.createContext({ window, chrome, URL, Blob, AMP22Participation: schema, AMP22NFLCollector: collector,
    crypto: { randomUUID: () => 'job-id' }, setTimeout() {},
    location: { href: url, origin: 'https://pro.nfl.com' },
    document: { body: { appendChild() {} }, createElement() {
      const anchor = { click() { anchors.push(this); }, remove() {} };
      return anchor;
    } },
  });
  vm.runInContext(source('content.js'), context);
  const send = (packet) => receive({ source: window, origin: 'https://pro.nfl.com',
    data: { channel: 'amp22-participation-v1', jobId: 'job-id', ...packet } });
  const command = (action, fields = {}) => new Promise((resolve) =>
    listen({ action, game: 'source-game', tabId: 4, ...fields }, { id: 'extension' }, resolve));
  return { context, saved, downloads, anchors, send, command };
}

test('browser extension includes correctly sized PNGs for its toolbar and installation icons', () => {
  const folder = path.join(__dirname, '../extensions/nflpro');
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  for (const icons of [manifest.icons, manifest.action.default_icon]) {
    assert.ok(icons);
    for (const [size, name] of Object.entries(icons)) {
      const image = fs.readFileSync(path.join(folder, name));
      assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      assert.equal(image.toString('ascii', 12, 16), 'IHDR');
      assert.equal(image.readUInt32BE(16), Number(size));
      assert.equal(image.readUInt32BE(20), Number(size));
    }
  }
  assert.ok(manifest.icons['128']);
  assert.ok(manifest.action.default_icon['16']);
  assert.ok(manifest.action.default_icon['32']);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.ok(manifest.permissions.includes('downloads'));
});

test('one-click sweep uses the unfiltered game endpoint, captures every unvisited play, and leaves the player unchanged', async () => {
  const r = page();
  const selected = r.window.$nuxt.$store.state.film.selectedPlay;
  await r.window.AMP22Capture.start('job-id');
  assert.equal(r.calls.length, 3 + chartingRequests);
  assert.equal(r.calls[0].endpoint, '/api/secured/videos/filmroom/plays');
  assert.deepEqual(Object.keys(r.calls[0].options.params).sort(), ['gameId', 'season', 'seasonType', 'weekSlug']);
  assert.deepEqual(r.calls.filter(call => call.endpoint.endsWith('/summaryPlay')).map((call) => call.options.params.playId), ['17', '18']);
  assert.ok(r.calls.every((call) => !call.endpoint.includes('/coaches')));
  assert.equal(r.window.$nuxt.$store.state.film.selectedPlay, selected);
  const result = r.messages.find((message) => message.kind === 'complete');
  assert.deepEqual(Array.from(result.playIds), ['17', '18']);
  assert.equal(result.rows.length, 44);
  assert.equal(schema.validate(result.rows).length, 2);
  assert.ok(r.delays.includes(500));
});

test('capture queries each verified charting partition separately and exports explicit negative values with provenance', async () => {
  const r = page(undefined, async (_endpoint, options) => {
    const field = schema.CHARTING_FIELDS.find(field => Object.hasOwn(options.params, field.query));
    const parameter = options.params[field.query];
    assert.deepEqual(Object.keys(options.params).sort(), ['gameId', 'season', 'seasonType', 'weekSlug', field.query].sort());
    if (['1', 'SHOTGUN', 'LIGHT', 'BASE'].includes(parameter)) return { count: 1, plays: [play(17)] };
    if (['0', 'PISTOL', 'STACKED', 'DIME'].includes(parameter)) return { count: 1, plays: [play(18)] };
    return { count: 0, plays: [] };
  });
  await r.window.AMP22Capture.start('job-id');
  const complete = r.messages.find(message => message.kind === 'complete');
  assert.ok(complete);
  assert.equal(complete.chartedPlays, 2);
  const first = complete.rows.find(row => row.source_play_id === '17');
  const second = complete.rows.find(row => row.source_play_id === '18');
  assert.equal(first.qb_alignment, 'Shotgun');
  assert.equal(first.motion, 'true');
  assert.equal(second.qb_alignment, 'Pistol');
  assert.equal(second.motion, 'false');
  assert.equal(second.blitz, 'false');
  assert.equal(second.box_category, 'Stacked (8+)');
  assert.equal(second.defensive_personnel_group, 'Dime');
  assert.equal(second.charting_method, 'filtered-playlists');
  assert.ok(Number.isFinite(Date.parse(second.charting_captured_at)));
  assert.equal(r.location.href, url);
  const c = content();
  await c.command('prepare-game');
  for (const packet of r.messages) c.send(packet);
  assert.match((await c.command('capture-status')).status.message, /charting available for 2/);
  assert.equal(c.downloads[0].rows.find(row => row.source_play_id === '18').pressure, 'false');
});

test('ignored or truncated charting filters stop capture explicitly instead of inventing charting', async () => {
  for (const charted of [
    { count: 2, plays: [play(17), play(18)] },
    { count: 2, plays: [play(17)] },
  ]) {
    const r = page(undefined, async () => charted);
    await r.window.AMP22Capture.start('job-id');
    assert.equal(r.messages.at(-1).kind, 'error');
    assert.equal(r.messages.at(-1).diagnostics.failure.stage, 'charting');
    assert.ok(!r.messages.some(message => message.kind === 'complete'));
  }
});

test('whole-game capture rejects truncated, duplicated and mixed-game playlists instead of exporting partial data', async () => {
  for (const response of [
    { count: 3, plays: [play(17), play(18)] },
    { count: 2, plays: [play(17), play(17)] },
    { count: 2, plays: [play(17), { ...play(18), fapiGameId: 'other-game' }] },
  ]) {
    const r = page(async () => response);
    await r.window.AMP22Capture.start('job-id');
    assert.equal(r.calls.length, 1);
    assert.ok(r.messages.some((message) => message.kind === 'error'));
    assert.ok(!r.messages.some((message) => message.kind === 'complete'));
  }
});

test('sweep retries rate limits but stops on lost authorization, bad participation, cancellation, and game changes', async () => {
  let retry = true;
  const r = page(async (endpoint) => {
    if (retry) { retry = false; throw { response: { status: 429, headers: { 'retry-after': '2' } } }; }
    return endpoint.endsWith('/plays') ? { count: 1, plays: [play(17)] } : expanded();
  });
  await r.window.AMP22Capture.start('job-id');
  assert.ok(r.delays.includes(2000));
  assert.ok(r.messages.some((message) => message.kind === 'complete'));
  const denied = page(async () => { throw { response: { status: 401 }, message: 'Sign in required' }; });
  await denied.window.AMP22Capture.start('job-id');
  assert.equal(denied.calls.length, 1);
  assert.match(denied.messages.at(-1).message, /Sign in required/);
  const missing = page(async (endpoint) => endpoint.endsWith('/plays') ? { count: 1, plays: [play(17)] } : { home: [], away: [], homeIsOffense: false });
  await missing.window.AMP22Capture.start('job-id');
  assert.equal(missing.messages.at(-1).kind, 'error');
  for (const cancel of [true, false]) {
    let release;
    const stopped = page(async (endpoint) => endpoint.endsWith('/plays') ? { count: 1, plays: [play(17)] } :
      new Promise((resolve) => { release = resolve; }));
    const running = stopped.window.AMP22Capture.start('job-id');
    await new Promise((resolve) => setImmediate(resolve));
    if (cancel) stopped.window.AMP22Capture.stop('job-id');
    else stopped.location.href = url.replace('source-game', 'other-game');
    release(expanded());
    await running;
    assert.ok(!stopped.messages.some((message) => message.kind === 'complete'));
  }
});

test('source identifiers and formatted down/distance are normalized without exporting private fields', () => {
  const rows = collector.participation({ ...play(17), down: '2nd & 7', token: 'private' }, expanded(), url);
  assert.equal(rows[0].down, '2');
  assert.equal(rows[0].description, 'Synthetic test play');
  assert.ok(!JSON.stringify(rows).includes('private'));
  assert.equal(schema.validate(rows).length, 1);
});

test('a blank optional NFL player ID falls back to the available GSIS ID', () => {
  const response = expanded();
  response.home[0].nflId = '';
  response.home[1].nflId = ' ';
  const rows = collector.participation(play(17), response, url);
  assert.equal(rows[0].source_player_id, response.home[0].gsisId);
  assert.equal(rows[1].source_player_id, response.home[1].gsisId);
  assert.equal(schema.validate(rows).length, 1);
});

test('NFL Pro zero-down markers become missing downs without relaxing CSV validation or erasing zero distance', () => {
  for (const down of [0, '0', '--', null, undefined]) {
    const rows = collector.participation({ ...play(3438), down, yardsToGo: 0 }, expanded(), url);
    assert.ok(rows.every((row) => row.down === '' && row.yards_to_go === '0'));
    assert.equal(schema.validate(rows).length, 1);
    assert.throws(() => schema.validate(rows.map((row) => ({ ...row, down: '0' }))), /Invalid participation down/);
  }
  for (const down of [1, 2, 3, 4]) {
    const rows = collector.participation({ ...play(17), down }, expanded(), url);
    assert.equal(rows[0].down, String(down));
  }
});

test('a 148-play sweep continues past the reported third-play zero-down failure and downloads the whole CSV once', async () => {
  const plays = [
    play(2946), play(2968), { ...play(3438), down: 0, yardsToGo: 0 },
    ...Array.from({ length: 145 }, (_, i) => play(4000 + i)),
  ];
  const r = page(async (endpoint) => endpoint.endsWith('/plays') ? { count: 148, plays } : expanded());
  await r.window.AMP22Capture.start('job-id');
  assert.equal(r.calls.length, 149 + chartingRequests);
  const result = r.messages.at(-1);
  assert.equal(result.kind, 'complete');
  assert.equal(result.playIds.length, 148);
  assert.equal(result.rows.length, 148 * 22);
  assert.equal(schema.validate(result.rows).length, 148);
  assert.ok(result.rows.filter((row) => row.source_play_id === '3438').every((row) => row.down === ''));
  const c = content();
  await c.command('prepare-game');
  for (const packet of r.messages) c.send(packet);
  assert.equal((await c.command('capture-status')).status.phase, 'complete');
  assert.equal(c.downloads.length, 1);
  assert.equal(schema.validate(c.downloads[0].rows).length, 148);
});

test('a completed authorized job downloads once, strips private fields, and stores only progress metadata', async () => {
  const r = content();
  r.send({ kind: 'complete', rows: [] });
  assert.equal(r.downloads.length, 0, 'page messages cannot initiate an unauthorized download');
  assert.equal((await r.command('prepare-game')).jobId, 'job-id');
  r.send({ kind: 'progress', total: 2, completed: 2 });
  const rows = [17, 18].flatMap((id) => collector.participation(play(id), expanded(), url)).map((row) => ({ ...row, token: 'private' }));
  r.send({ kind: 'complete', playIds: ['17', '18'], rows });
  r.send({ kind: 'complete', playIds: ['17', '18'], rows });
  const result = await r.command('capture-status');
  assert.equal(result.status.phase, 'complete');
  assert.equal(r.downloads.length, 1);
  assert.ok(!JSON.stringify(r.downloads).includes('private'));
  assert.ok(!JSON.stringify(r.saved).includes('Fixture'));
});

test('missing participation, malformed progress, duplicate coverage, and cancelled jobs never download a CSV', async () => {
  for (const packet of [
    { kind: 'progress', completed: 3, total: 2 },
    { kind: 'complete', playIds: ['17', '18'], rows: collector.participation(play(17), expanded(), url) },
    { kind: 'complete', playIds: ['17', '17'], rows: collector.participation(play(17), expanded(), url) },
  ]) {
    const r = content();
    await r.command('prepare-game');
    r.send({ kind: 'progress', total: 2, completed: 2 });
    r.send(packet);
    assert.equal((await r.command('capture-status')).status.phase, 'error');
    assert.equal(r.downloads.length, 0);
  }
  const r = content();
  await r.command('prepare-game');
  r.send({ kind: 'progress', completed: 1, total: 1 });
  await r.command('cancel-game');
  r.send({ kind: 'complete', playIds: ['17'], rows: collector.participation(play(17), expanded(), url) });
  assert.equal((await r.command('capture-status')).status.phase, 'cancelled');
  assert.equal(r.downloads.length, 0);
});

test('browsers without the Downloads API request an automatic Blob download without another extension button', async () => {
  const r = content(async () => ({ supported: false }));
  await r.command('prepare-game');
  r.send({ kind: 'progress', total: 1, completed: 1 });
  r.send({ kind: 'complete', playIds: ['17'], rows: collector.participation(play(17), expanded(), url) });
  assert.equal((await r.command('capture-status')).status.phase, 'complete');
  assert.equal(r.anchors.length, 1);
  assert.equal(r.anchors[0].download, 'nflpro-2026-source-game.csv');
  URL.revokeObjectURL(r.anchors[0].href);
});

test('download errors stay visible and a reloaded page reports an interrupted capture', async () => {
  const r = content(async () => ({ error: 'Download denied' }));
  await r.command('prepare-game');
  r.send({ kind: 'progress', total: 1, completed: 1 });
  r.send({ kind: 'complete', playIds: ['17'], rows: collector.participation(play(17), expanded(), url) });
  assert.match((await r.command('capture-status')).status.message, /Download denied/);
  const reloaded = content();
  reloaded.saved['capture:4:source-game'] = { phase: 'capturing', jobId: 'old-job' };
  assert.match((await reloaded.command('capture-status')).status.message, /interrupted/);
});

test('background uses native CSV downloads only for valid same-game capture requests', async () => {
  let listen;
  const requested = [];
  const context = vm.createContext({ AMP22Participation: schema, AMP22NFLCollector: collector, importScripts() {}, URL, TextEncoder,
    chrome: { runtime: { id: 'extension', onMessage: { addListener(callback) { listen = callback; } } },
      downloads: { async download(options) { requested.push(options); return 9; } } } });
  vm.runInContext(source('background.js'), context);
  const rows = collector.participation(play(17), expanded(), url);
  const send = (sender) => new Promise((resolve) => listen({ action: 'download-game', rows }, sender, resolve));
  assert.equal((await send({ id: 'extension', tab: { url } })).downloadId, 9);
  assert.equal(requested[0].filename, 'nflpro-2026-source-game.csv');
  assert.equal(requested[0].saveAs, false);
  assert.ok(requested[0].url.startsWith('data:text/csv;charset=utf-8,'));
  assert.ok((await send({ id: 'extension', tab: { url: url.replace('source-game', 'other-game') } })).error);
  assert.ok((await send({ id: 'other-extension', tab: { url } })).error);
  assert.equal(requested.length, 1);
  const report = {
    game_id: 'source-game', extension_version: '0.2.1', completed: 2, total: 148,
    failure: { stage: 'validation', field: 'down', value: '0', source_play_id: '19' },
    authorization: 'private-credential', events: [],
  };
  const logResult = await new Promise((resolve) => listen({ action: 'download-diagnostics', diagnostics: report },
    { id: 'extension', tab: { url } }, resolve));
  assert.equal(logResult.downloadId, 9);
  assert.equal(requested[1].filename, 'AMP22-NFL-Pro-diagnostics-source-game.json');
  assert.ok(requested[1].url.startsWith('data:application/json;charset=utf-8,'));
  assert.ok(!decodeURIComponent(requested[1].url).includes('private-credential'));
});

test('status-storage failures remain visible and do not permanently poison the next capture', async () => {
  const r = content();
  const set = r.context.chrome.storage.local.set;
  r.context.chrome.storage.local.set = async () => { throw new Error('Storage quota exceeded'); };
  r.context.console = { error() {} };
  assert.match((await r.command('prepare-game')).error, /Storage quota exceeded/);
  assert.match((await r.command('capture-status')).status.message, /Storage quota exceeded/);
  r.context.chrome.storage.local.set = set;
  assert.equal((await r.command('prepare-game')).jobId, 'job-id');
});

test('the popup starts the complete game sweep with one button click and never asks for manual play visits or export', async () => {
  const elements = new Map(), clicks = new Map(), injected = [], started = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { addEventListener: (_event, callback) => clicks.set(id, callback), removeAttribute() {} });
    return elements.get(id);
  };
  const context = vm.createContext({ URL,
    document: { getElementById: element },
    window: { AMP22Capture: { start: (id) => started.push(id) } },
    chrome: { storage: { onChanged: { addListener() {} } }, tabs: {
      async query() { return [{ id: 4, url }]; },
      async sendMessage(_id, message) { return message.action === 'prepare-game' ? { jobId: 'job-id' } : {}; },
    }, scripting: { async executeScript(options) { injected.push(options); options.func?.(...options.args); } } },
  });
  vm.runInContext(source('popup.js'), context);
  await new Promise((resolve) => setImmediate(resolve));
  await clicks.get('capture')();
  assert.deepEqual(started, ['job-id']);
  assert.equal(injected.length, 2);
  assert.ok(!/id="(?:start|stop|export|clear)"/.test(source('popup.html')));
});

test('validation names the failed field, value, play and row without disclosing names or descriptions', () => {
    const rows = collector.participation(play(17), expanded(), url);
    const invalid = rows.map((row, i) => i === 2 ? { ...row, clock: '14:80' } : row);
    assert.throws(() => schema.validate(invalid), (error) => {
      assert.deepEqual(error.detail, { field: 'clock', value: '14:80', row: 3, source_play_id: '17' });
      assert.match(error.message, /clock.*14:80.*play 17, row 3/);
      return true;
    });
    assert.throws(() => schema.validate(rows.map((row) => ({ ...row, name: 'private-name'.repeat(30) }))), (error) =>
      error.detail.field === 'name' && !error.message.includes('private-name'));
  });

test('a third-play validation failure produces precise diagnostics and does not retry malformed data', async () => {
    const r = page(async (endpoint) => endpoint.endsWith('/plays')
      ? { count: 3, plays: [play(17), play(18), { ...play(19), down: 5 }] } : expanded());
    await r.window.AMP22Capture.start('job-id');
    const failure = r.messages.at(-1);
    assert.equal(failure.kind, 'error');
    assert.equal(failure.diagnostics.completed, 2);
    assert.equal(failure.diagnostics.total, 3);
    assert.equal(failure.diagnostics.failure.stage, 'validation');
    assert.equal(failure.diagnostics.failure.source_play_id, '19');
    assert.equal(failure.diagnostics.failure.field, 'down');
    assert.equal(failure.diagnostics.failure.value, '5');
    assert.equal(r.calls.filter((call) => call.options.params.playId === '19').length, 1);
    assert.ok(!r.messages.some((packet) => packet.kind === 'complete'));
  });

test('transport retries stop after three attempts and diagnostics retain their status and retry delays', async () => {
    const r = page(async () => { throw { response: { status: 503 }, code: 'ERR_BAD_RESPONSE', message: 'Temporary error' }; });
    await r.window.AMP22Capture.start('job-id');
    assert.equal(r.calls.length, 3);
    const events = r.messages.at(-1).diagnostics.events;
    assert.deepEqual(Array.from(events.filter((event) => event.type === 'request'), (event) => event.attempt), [1, 2, 3]);
    assert.deepEqual(Array.from(events.filter((event) => event.type === 'retry'), (event) => event.retry_ms), [2000, 4000]);
    assert.equal(r.messages.at(-1).diagnostics.failure.http_status, 503);
  });

test('diagnostic export whitelists metadata, bounds its history, and excludes raw responses and credentials', async () => {
    const raw = {
      game_id: 'source-game', extension_version: '0.2.1', completed: 2, total: 148,
      authorization: 'private-credential', response: { token: 'private-credential' },
      failure: { stage: 'validation', source_play_id: '19', field: 'name', value: 'private-player-name',
        headers: { cookie: 'private-credential' } },
      events: Array.from({ length: 250 }, () => ({ type: 'request', endpoint: 'participation',
        headers: { authorization: 'private-credential' }, response: 'private-response' })),
    };
    const cleaned = collector.diagnostics(raw, schema);
    assert.equal(cleaned.events.length, 200);
    assert.ok(!JSON.stringify(cleaned).includes('private'));
    const r = content();
    await r.command('prepare-game');
    r.send({ kind: 'error', message: 'Validation failed', diagnostics: raw });
    assert.equal((await r.command('capture-status')).status.diagnostics.extension_version, extensionVersion);
    const result = await r.command('download-diagnostics');
    assert.equal(result.filename, 'AMP22-NFL-Pro-diagnostics-source-game.json');
    assert.equal(r.downloads[0].action, 'download-diagnostics');
    assert.ok(!JSON.stringify(r.downloads).includes('private'));
  });
