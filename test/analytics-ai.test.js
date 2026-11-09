'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const http = require('node:http');
const AI = require('../src/shared/analysis-ai');
const A = require('../src/shared/analysis');
const { AnalyticsAI, localOllama, localJson, registerAnalyticsAI } = require('../src/main/analytics-ai');

const labels = { offense: ['all', '11', '12'], defense: ['all', 'Nickel*', 'Unknown'] };
const context = { team: 'BAL', side: 'defense', scope: '2024 Week 4 BUF at BAL', snaps: 4, filters: 'All filtered plays' };
const plan = {
  status: 'ok', reason: '', group: 'all', split: 'type', metric: 'epa', order: 'low',
  playType: 'all', down: 0, half: 'all', offense: 'all', defense: 'all',
  motion: 'all', playAction: 'all', minSnaps: 1, player: 'all', presence: 'all', downRange: 'all', minDistance: 0, maxDistance: 0,
};
const tag = { name: 'qwen3:8b', size: 5000000000, digest: 'a'.repeat(64) };
const detail = {
  details: { format: 'gguf' }, model_info: { 'general.architecture': 'qwen3' },
  capabilities: ['completion', 'tools'],
};
const plays = [
  { gameId: 'g1', playId: 1, defteam: 'BAL', posteam: 'BUF', playType: 'pass', qtr: 1, down: 3, ydstogo: 7,
    yards: 10, epa: 1, personnel: { offense: '11' }, charting: { motion: true } },
  { gameId: 'g1', playId: 2, defteam: 'BAL', posteam: 'BUF', playType: 'run', qtr: 3, down: 1,
    yards: 0, epa: 0, personnel: { offense: '12' }, charting: { motion: false } },
  { gameId: 'g2', playId: 1, defteam: 'BAL', posteam: 'CIN', playType: 'pass', qtr: 1, down: 3, ydstogo: 5,
    yards: null, epa: null, personnel: { offense: '11' } },
  { gameId: 'g2', playId: 2, defteam: 'BAL', posteam: 'CIN', playType: 'run', qtr: 5, down: 4, ydstogo: 2,
    yards: 2, epa: -1, flags: { first_down: true } },
];
const options = { team: 'BAL', side: 'defense', packages: A.DEFAULT_PACKAGES };

test('queries reject malformed shapes, unknown labels/dimensions, unsafe integers and unsupported empty reasons', () => {
  assert.equal(AI.validatePlan(plan, labels), plan);
  for (const mutation of [
    { group: 'SQL' }, { defense: 'Invented' }, { minSnaps: 0 }, { down: 5 }, { half: 'Q1' },
    { extra: 'instruction' }, { reason: 'x'.repeat(401) }, { status: 'unsupported', reason: '' },
  ]) assert.throws(() => AI.validatePlan({ ...plan, ...mutation }, labels), /invalid|interpret/);
  assert.throws(() => AI.validatePlan([], labels), /invalid/);
  assert.throws(() => AI.prompt('', context, labels), /question/);
  assert.throws(() => AI.prompt('x'.repeat(1001), context, labels), /question/);
});

test('personnel filters can only name labels present in the question, preserving estimate markers', () => {
  assert.deepEqual(AI.queryCatalog('Compare EPA by defensive package', labels), { offense: ['all'], defense: ['all'], players: [] });
  assert.deepEqual(AI.queryCatalog('Compare Nickel against 11 personnel', labels),
    { offense: ['all', '11'], defense: ['all', 'Nickel*'], players: [] });
  assert.deepEqual(AI.queryCatalog('2011 results', labels), { offense: ['all'], defense: ['all'], players: [] });
  assert.equal(AI.schema(labels).additionalProperties, false);
  assert.deepEqual(new Set(AI.schema(labels).required), new Set(Object.keys(plan)));
});

test('computed answers retain zeros, missing-data denominators and game/play identity', () => {
  const answer = AI.execute([...plays, plays[0]], options, plan);
  assert.equal(answer.n, 4);
  assert.equal(answer.knownEpa, 3);
  assert.equal(answer.knownYards, 3);
  assert.equal(answer.rows[0].epa, -0.5);
  assert.equal(answer.rows[1].epaN, 1);
  assert.match(answer.summary, /-0.50 \(2 known observations; 2 snaps\)/);
  assert.deepEqual(answer.rows[1].plays.map(A.playKey), [A.playKey(plays[0]), A.playKey(plays[2])]);
});

test('question filters intersect the supplied cohort and never restore excluded plays', () => {
  const answer = AI.execute(plays.slice(1), options, { ...plan, group: 'all', split: 'none', playType: 'pass', down: 3, offense: '11' });
  assert.equal(answer.n, 1);
  assert.equal(answer.rows[0].epa, null);
  assert.match(answer.summary, /Missing values are not zero/);
  assert.equal(AI.execute([], options, plan).n, 0);
  assert.match(AI.execute([], options, plan).summary, /No scored snaps/);
});

test('false charting, half, minimum samples and conversion denominators remain explicit', () => {
  const noMotion = AI.execute(plays, options, { ...plan, motion: 'no' });
  assert.equal(noMotion.n, 1);
  assert.equal(noMotion.rows[0].epa, 0);
  const overtime = AI.execute(plays, options, { ...plan, half: 'overtime', metric: 'conversion' });
  assert.equal(overtime.n, 1);
  assert.equal(overtime.rows[0].conversion, 1);
  assert.match(overtime.summary, /1 known observations/);
  assert.match(AI.execute(plays, options, { ...plan, minSnaps: 3 }).summary, /minimum of 3/);
  assert.throws(() => AI.execute(plays, options, { ...plan, status: 'unsupported', reason: 'Cannot infer causality.' }), /causality/);
});

const roster = prefix => Array.from({ length: 11 }, (_value, index) => ({ id: `${prefix}-${index}`, name: `Player ${prefix} ${index}` }));
const hamilton = { id: '00-0037235', name: 'Kyle Hamilton' };
const playerPlays = plays.map((play, index) => ({
  ...play,
  personnel: { ...play.personnel, defense: index % 2 ? 'Dime' : 'Nickel' },
  onField: {
    defense: index === 0 || index === 2 ? [hamilton, ...roster('defense').slice(1)] :
      index === 1 ? roster('without') : [],
    offense: roster('offense'),
  },
}));

test('player names and abbreviations resolve only to unambiguous catalog IDs', () => {
  const catalog = AI.catalog(playerPlays, options.packages);
  for (const question of [
    'Compare with and without Kyle Hamilton', 'Compare with and without K.Hamilton',
    'Compare with and without Hamilton', 'Compare presence for 00-0037235',
  ]) assert.deepEqual(AI.queryCatalog(question, catalog).players.map(player => player.id), [hamilton.id]);
  assert.deepEqual(AI.queryCatalog('Compare with Kendall Hamilton', catalog).players, []);
  assert.deepEqual(AI.queryCatalog('Compare EPA by package', catalog).players, []);
  const initials = { ...catalog, players: [{ ...hamilton, name: 'K.Hamilton', sides: ['defense'] }] };
  assert.equal(AI.queryCatalog('with and without Kyle Hamilton', initials).players[0].id, hamilton.id);
  const ambiguous = { ...catalog, players: [...catalog.players, { id: 'other-id', name: 'Kendrick Hamilton', sides: ['defense'] }] };
  assert.throws(() => AI.queryCatalog('with and without Hamilton', ambiguous), /multiple players/);
  assert.equal(AI.queryCatalog('with and without Kyle Hamilton', ambiguous).players[0].id, hamilton.id);
  assert.throws(() => AI.validatePlan({ ...plan, player: 'invented', presence: 'compare' }, catalog), /invalid player/);
  assert.throws(() => AI.validatePlan({ ...plan, presence: 'compare' }, catalog), /invalid player-presence/);
  assert.throws(() => AI.validateCatalog({ ...catalog, players: [...catalog.players, catalog.players[0]] }), /catalog/);
  assert.throws(() => AI.validateCatalog({ ...catalog, players: null }), /catalog/);
  for (const [name, question] of [
    ['Amon-Ra St. Brown', 'Compare with and without St Brown'],
    ['Odell Beckham Jr.', 'Compare with and without Odell Beckham'],
  ]) {
    const namedCatalog = { ...catalog, players: [{ id: 'example-id', name, sides: ['offense'] }] };
    assert.equal(AI.queryCatalog(question, namedCatalog).players[0].id, 'example-id');
  }
  const unnamedCatalog = AI.catalog([{ ...playerPlays[0], onField: { defense: [{ id: 'unnamed-id' }] } }], options.packages);
  assert.equal(AI.queryCatalog('Compare with and without unnamed-id', unnamedCatalog).players[0].id, 'unnamed-id');
});

test('with/without comparisons retain exact metric denominators and unknown evidence without ranking it', () => {
  const comparison = { ...plan, split: 'none', player: hamilton.id, presence: 'compare' };
  const answer = AI.execute([...playerPlays, playerPlays[0]], options, comparison);
  assert.equal(answer.n, 4);
  const withPlayer = answer.rows.find(row => row.presence === 'with');
  const withoutPlayer = answer.rows.find(row => row.presence === 'without');
  const unknown = answer.rows.find(row => row.presence === 'unknown');
  assert.equal(withPlayer.n, 2);
  assert.equal(withPlayer.epaN, 1);
  assert.equal(withPlayer.epa, 1);
  assert.equal(withPlayer.share, 0.5);
  assert.equal(withoutPlayer.n, 1);
  assert.equal(withoutPlayer.epa, 0);
  assert.equal(unknown.epa, -1);
  assert.equal(answer.rows.at(-1), unknown, 'unknown does not rank as better defensive performance');
  assert.match(answer.summary, /Without Kyle Hamilton/);
  assert.match(answer.participation, /With: 2 snaps; confirmed without: 1; unknown: 1/);
  assert.deepEqual(withPlayer.plays.map(A.playKey), playerPlays.filter((_play, index) => index === 0 || index === 2).map(A.playKey));
  assert.match(answer.interpretation, /Player presence: compare/);
  const runPass = AI.execute(playerPlays, options, { ...comparison, split: 'type' });
  assert.equal(runPass.rows.find(row => row.presence === 'with').series, 'Pass (incl. sacks)');
});

test('confirmed absence requires complete unique participation on the player side, not the opposite side', () => {
  const incomplete = [
    playerPlays[0],
    { ...playerPlays[1], playId: 8, onField: { offense: roster('offense'), defense: roster('partial').slice(0, 10) } },
    { ...playerPlays[1], playId: 9, onField: { defense: Array(11).fill({ id: 'duplicated', name: 'Duplicate' }) } },
    { ...playerPlays[1], playId: 10, onField: { defense: [...roster('without').slice(0, 10), { name: 'Missing ID' }] } },
    playerPlays[1],
  ];
  const comparison = { ...plan, split: 'none', player: hamilton.id, presence: 'compare' };
  const answer = AI.execute(incomplete, options, comparison);
  assert.equal(answer.rows.find(row => row.presence === 'without').n, 1);
  assert.equal(answer.rows.find(row => row.presence === 'unknown').n, 3);
  const sourcePlayer = { sourceId: '1234', name: 'NFL Pro Player' };
  const imported = { ...playerPlays[0], onField: { defense: [sourcePlayer] } };
  assert.equal(AI.execute([imported], options, { ...comparison, player: 'nflpro:1234' }).rows[0].presence, 'with');
});

test('player presence intersects other filters and selections without inventing absent or zero-snap rows', () => {
  const comparison = { ...plan, split: 'none', player: hamilton.id, presence: 'compare' };
  const filtered = AI.execute(playerPlays, options, { ...comparison, playType: 'pass', down: 3 });
  assert.equal(filtered.n, 2);
  assert.equal(filtered.rows.length, 1);
  assert.match(filtered.participation, /Both confirmed groups are not present/);
  assert.equal(AI.execute(playerPlays, options, { ...comparison, presence: 'with' }).n, 2);
  assert.equal(AI.execute(playerPlays, options, { ...comparison, presence: 'without' }).n, 1);
  assert.match(AI.execute(playerPlays, options, { ...comparison, minSnaps: 10 }).summary, /minimum of 10/);
  const counts = AI.execute(playerPlays, options, { ...comparison, presence: 'with', metric: 'snaps' });
  assert.equal(counts.rows[0].snaps, 2, 'missing EPA/yards still count as scored snaps');
  assert.match(counts.summary, /2 known observations; 2 snaps/);
});

test('situational distance and down-range filters honor inclusive bounds and exclude missing distance', () => {
  assert.equal(AI.execute(plays, options, { ...plan, downRange: 'early' }).n, 1);
  assert.equal(AI.execute(plays, options, { ...plan, downRange: 'late' }).n, 3);
  assert.equal(AI.execute(plays, options, { ...plan, down: 3, minDistance: 7 }).n, 1);
  assert.equal(AI.execute(plays, options, { ...plan, minDistance: 5, maxDistance: 7 }).n, 2);
  assert.equal(AI.execute(plays, options, { ...plan, maxDistance: 3 }).n, 1);
  assert.match(AI.execute(plays, options, { ...plan, maxDistance: 3 }).interpretation, /known distance only/);
  assert.throws(() => AI.validatePlan({ ...plan, down: 3, downRange: 'early' }, labels), /conflicting/);
  assert.throws(() => AI.validatePlan({ ...plan, minDistance: 8, maxDistance: 3 }, labels), /conflicting/);
});

test('explicit question constraints cannot silently lose comparison direction, groups, splits or situations', () => {
  const labels = AI.catalog(playerPlays, options.packages);
  const grounded = question => AI.querySchema(question, AI.queryCatalog(question, labels));
  const comparison = grounded('Compare EPA on third-down passes with and without Kyle Hamilton.');
  assert.deepEqual(comparison.properties.player.enum, [hamilton.id]);
  assert.deepEqual(comparison.properties.presence.enum, ['compare']);
  assert.equal(comparison.properties.down.minimum, 3);
  assert.equal(comparison.properties.down.maximum, 3);
  assert.deepEqual(comparison.properties.playType.enum, ['pass']);
  assert.throws(() => AI.validatePlan({ ...plan, split: 'none', playType: 'pass', player: hamilton.id, presence: 'compare' }, labels, comparison), /invalid down/);
  assert.deepEqual(grounded('Compare passing plays without Hamilton').properties.presence.enum, ['without']);
  assert.deepEqual(grounded('Compare passes without Hamilton with at least 10 yards to go').properties.presence.enum, ['without']);
  assert.deepEqual(grounded('Compare Hamilton on and off the field').properties.presence.enum, ['compare']);
  assert.deepEqual(grounded('Compare YPP with and without Hamilton in the first and second half').properties.half.enum, ['all']);
  assert.deepEqual(grounded('Compare offensive EPA by defensive package').properties.group.enum, ['defense']);
  assert.deepEqual(grounded('Compare run and pass YPP').properties.split.enum, ['type']);
  assert.throws(() => AI.queryCatalog(undefined, labels), /question/);
  assert.equal(grounded('Compare third and long, at least 10 yards to go').properties.minDistance.minimum, 10);
  assert.equal(grounded('Compare third and 8+').properties.maxDistance.maximum, 0);
  assert.equal(grounded('Compare third and 8').properties.maxDistance.maximum, 8);
  assert.equal(grounded('Compare EPA on 3rd & long').properties.down.minimum, 3);
  assert.equal(grounded('Compare at least 5 snaps per group').properties.minSnaps.minimum, 5);
});

test('Ollama verification rejects cloud aliases, remote metadata, stubs and non-tool models', () => {
  assert.equal(localOllama(tag, detail), true);
  for (const bad of [
    { ...tag, name: 'qwen-cloud' }, { ...tag, size: 100 }, { ...tag, digest: '' },
    { ...tag, remote_host: 'https://ollama.com' }, { ...tag, metadata: { remote_model: 'alias' } },
  ]) assert.equal(localOllama(bad, detail), false);
  for (const bad of [
    { ...detail, remote_model: 'qwen3' }, { ...detail, details: { format: 'cloud' } },
    { ...detail, capabilities: ['embedding'] }, { ...detail, capabilities: ['completion'] }, {},
  ]) assert.equal(localOllama(tag, bad), false);
});

test('unsupported platforms and Apple hardware never probe Windows runtimes or show models', async () => {
  for (const config of [
    { platform: 'linux' }, { platform: 'darwin', arch: 'x64', release: '25.0' },
    { platform: 'darwin', arch: 'arm64', release: '24.0' },
  ]) {
    const service = new AnalyticsAI({ ...config, request: () => assert.fail('must not probe'),
      native: () => assert.fail('must not start helper') });
    assert.deepEqual(await service.discover(), []);
  }
});

test('Apple uses only its bundled helper, hides unavailable models and sends the shared constrained schema', async () => {
  let available = false;
  const service = new AnalyticsAI({ platform: 'darwin', arch: 'arm64', release: '25.0', exists: () => true,
    request: () => assert.fail('no HTTP'), native: async (_binary, check, body) => {
      if (check) return { available };
      assert.deepEqual(body.schema.properties.defense.enum, ['all']);
      assert.match(body.instructions, /not an answer/);
      return plan;
    } });
  assert.deepEqual(await service.discover(), []);
  available = true;
  assert.equal((await service.discover())[0].id, 'apple');
  assert.deepEqual(await service.plan({ provider: 'apple', question: 'Compare EPA', context, catalog: labels }), plan);
});

test('Windows discovery is metadata-only and inference rechecks the local weight digest', async () => {
  const calls = [];
  let changed = false;
  const service = new AnalyticsAI({ platform: 'win32', request: async (runtime, endpoint, body) => {
    calls.push(endpoint);
    assert.equal(runtime, 'ollama');
    if (endpoint === '/api/tags') return { models: [{ ...tag, digest: (changed ? 'b' : 'a').repeat(64) }] };
    if (endpoint === '/api/show') return detail;
    assert.equal(endpoint, '/v1/chat/completions');
    assert.equal(body.stream, false);
    assert.deepEqual(body.response_format.json_schema.schema.properties.defense.enum, ['all']);
    return { choices: [{ message: { content: JSON.stringify(plan) } }] };
  } });
  assert.equal((await service.discover()).length, 1);
  assert.deepEqual(calls, ['/api/tags', '/api/show']);
  assert.deepEqual(await service.plan({ provider: `ollama:${tag.name}`, question: 'Compare EPA', context, catalog: labels }), plan);
  changed = true;
  await assert.rejects(service.plan({ provider: `ollama:${tag.name}`, question: 'Compare EPA', context, catalog: labels }), /changed/);
  assert.equal(calls.filter(c => c === '/v1/chat/completions').length, 1);
});

test('unsupported and stale Ollama entries do not hide an eligible model later in the inventory', async () => {
  const logs = [];
  const service = new AnalyticsAI({ platform: 'win32', log: text => logs.push(text),
    request: async (_runtime, endpoint, body) => {
      if (endpoint === '/api/tags') return { models: [
        ...Array.from({ length: 12 }, (_n, i) => ({ ...tag, name: `embedding-${i}` })),
        { ...tag, name: 'stale' }, tag,
      ] };
      if (body.model === 'stale') throw new Error('Missing model file');
      return body.model.startsWith('embedding') ? { ...detail, capabilities: ['embedding'] } : detail;
    } });
  assert.equal((await service.discover())[0].model, tag.name);
  assert.match(logs[0], /Missing model file/);
});

test('discovery failures are logged and hidden, but inference failures surface explicitly', async () => {
  const logs = [];
  const broken = new AnalyticsAI({ platform: 'win32', request: async () => { throw new Error('bad metadata'); }, log: text => logs.push(text) });
  assert.deepEqual(await broken.discover(), []);
  assert.match(logs[0], /bad metadata/);
  await assert.rejects(broken.plan({ provider: 'https://example.com' }), /no longer available/);
  const apple = new AnalyticsAI({ platform: 'darwin', arch: 'arm64', release: '25', exists: () => true,
    native: async (_binary, check) => { if (check) return { available: true }; throw new Error('Model failed'); } });
  await apple.discover();
  await assert.rejects(apple.plan({ provider: 'apple', question: 'Compare EPA', context, catalog: labels }), /Model failed/);
  assert.equal(apple.running, null);
});

test('cancellation aborts the active request and overlapping requests are rejected', async () => {
  const service = new AnalyticsAI({ platform: 'darwin', arch: 'arm64', release: '25', exists: () => true,
    native: (_binary, check, _body, signal) => check ? Promise.resolve({ available: true }) :
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })) });
  await service.discover();
  const pending = service.plan({ provider: 'apple', question: 'Compare EPA', context, catalog: labels });
  await assert.rejects(service.plan({ provider: 'apple', question: 'Compare EPA', context, catalog: labels }), /already running/);
  service.cancel();
  await assert.rejects(pending, /Cancelled/);
  assert.equal(service.running, null);
});

test('IPC is restricted to the main window and frame', async () => {
  const handlers = new Map();
  const webContents = { mainFrame: {} };
  const app = new EventEmitter();
  app.isPackaged = false;
  registerAnalyticsAI({ app, getWindow: () => ({ webContents }), ipcMain: { handle: (name, fn) => handlers.set(name, fn) } });
  await assert.rejects(handlers.get('analysis-ai:discover')({ sender: {}, senderFrame: {} }), /main AMP22 window/);
  assert.throws(() => handlers.get('analysis-ai:plan')({ sender: webContents, senderFrame: {} }, {}), /main AMP22 window/);
});

test('HTTP transport uses fixed loopback without proxy, rejects redirects/invalid JSON and bounds responses', async t => {
  let status = 200, payload = '{"models":[]}';
  t.mock.method(http, 'request', (options, callback) => {
    assert.equal(options.hostname, '127.0.0.1');
    assert.equal(options.port, 11434);
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = status;
      callback(response);
      response.end(payload);
      request.emit('close');
    });
    request.destroy = error => { request.emit('error', error); request.emit('close'); };
    request.on('error', () => {});
    return request;
  });
  assert.deepEqual(await localJson('ollama', '/api/tags', undefined, undefined, 20), { models: [] });
  status = 302;
  await assert.rejects(localJson('ollama', '/api/tags', undefined, undefined, 20), /redirects/);
  status = 200; payload = 'not JSON';
  await assert.rejects(localJson('ollama', '/api/tags', undefined, undefined, 20), /invalid JSON/);
  payload = 'x'.repeat(2 * 1024 * 1024 + 1);
  await assert.rejects(localJson('ollama', '/api/tags', undefined, undefined, 20), /too large/);
  assert.throws(() => localJson('remote', '/api/tags'), /Invalid/);
});

test('real Apple on-device model interprets representative questions using the constrained query schema', {
  skip: !process.env.A22_TEST_APPLE_AI, timeout: 240000,
}, async t => {
  const service = new AnalyticsAI();
  if (!(await service.discover()).length) { t.skip('Apple on-device model is unavailable'); return; }
  const playerCatalog = AI.catalog(playerPlays, options.packages);
  const failures = [];
  for (const [question, expected] of [
    ['Compare offensive EPA by defensive package on third-down passes.',
      { group: 'defense', split: 'none', metric: 'epa', down: 3, playType: 'pass', defense: 'all', offense: 'all' }],
    ['Compare run and pass yards per play.', { group: 'all', split: 'type', metric: 'ypp', playType: 'all' }],
    ['What was overall offensive success rate?', { group: 'all', split: 'none', metric: 'success' }],
    ['can you compare the defenses overall performance with and without kyle hamilton on the field',
      { group: 'all', split: 'none', metric: 'epa', order: 'low', player: hamilton.id, presence: 'compare' }],
    ['How did the defense perform when Hamilton was on the field versus off?',
      { group: 'all', split: 'none', metric: 'epa', player: hamilton.id, presence: 'compare' }],
    ['Compare defensive YPP with and without K.Hamilton, split by run and pass.',
      { group: 'all', split: 'type', metric: 'ypp', player: hamilton.id, presence: 'compare' }],
    ['Compare EPA on third-down passes with and without Hamilton.',
      { group: 'all', split: 'none', metric: 'epa', down: 3, playType: 'pass', player: hamilton.id, presence: 'compare' }],
    ['Which defensive package allowed the lowest YPP when Kyle Hamilton played?',
      { group: 'defense', split: 'none', metric: 'ypp', order: 'low', player: hamilton.id, presence: 'with' }],
    ['How did the defense perform without Hamilton?',
      { group: 'all', split: 'none', metric: 'epa', player: hamilton.id, presence: 'without' }],
    ['How many snaps did Kyle Hamilton play?',
      { group: 'all', split: 'none', metric: 'snaps', player: hamilton.id, presence: 'with' }],
    ['Compare yards per play and EPA with and without Hamilton.',
      { group: 'all', split: 'none', metric: 'ypp', player: hamilton.id, presence: 'compare' }],
    ['Compare offensive EPA with and without Hamilton on early downs.',
      { group: 'all', split: 'none', metric: 'epa', down: 0, downRange: 'early', player: hamilton.id, presence: 'compare' }],
    ['Compare defensive EPA with and without Hamilton on third and long.',
      { group: 'all', split: 'none', metric: 'epa', down: 3, minDistance: 7, maxDistance: 0, player: hamilton.id, presence: 'compare' }],
    ['Compare EPA with and without Hamilton on third and long, with at least 10 yards to go.',
      { group: 'all', split: 'none', metric: 'epa', down: 3, minDistance: 10, maxDistance: 0, player: hamilton.id, presence: 'compare' }],
    ['Compare YPP by defensive package with and without Hamilton; require at least 5 snaps per group.',
      { group: 'defense', metric: 'ypp', minSnaps: 5, player: hamilton.id, presence: 'compare' }],
    ['Compare first and second half EPA with and without Hamilton.',
      { group: 'half', split: 'none', metric: 'epa', player: hamilton.id, presence: 'compare' }],
    ['Which player caused the coverage breakdown?', { status: 'unsupported' }],
    ['Did Hamilton cause the defense to improve?', { status: 'unsupported' }],
    ['Compare defense with and without Patrick Mahomes.', { status: 'unsupported' }],
  ]) {
    t.diagnostic(`Checking: ${question}`);
    try {
      const query = await service.plan({ provider: 'apple', question, context, catalog: playerCatalog });
      t.diagnostic(`Query: ${JSON.stringify(query)}`);
      for (const [key, value] of Object.entries(expected)) assert.equal(query[key], value, `${question}: ${key}`);
      if (query.status === 'ok') assert.ok(AI.execute(playerPlays, options, query).n <= playerPlays.length, question);
      t.diagnostic(`Passed: ${question}`);
    } catch (error) {
      failures.push(`${question}: ${error.message}`);
      t.diagnostic(`Failed: ${question}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], 'Every benchmark question must preserve its expected intent.');
});
