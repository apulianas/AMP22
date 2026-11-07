'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const schema = require('../src/shared/participation');
const collector = require('../extensions/nflpro/collector');
const advanced = require('../src/shared/advanced');
const reports = require('../src/shared/reports');
const presets = require('../src/shared/filter-presets');
const { parseCSV } = require('../src/shared/csv');
const { normalizePlay } = require('../src/shared/plays');
const { attachImports } = require('../src/main/participation');

const url = 'https://pro.nfl.com/film/plays?gameId=source-game&season=2026&seasonType=REG&weekSlug=WEEK_9';
const at = '2026-11-06T15:00:00.000Z';
const game = { season: 2026, gameType: 'REG', week: 9, awayTeam: 'BAL', homeTeam: 'BUF' };
const sourcePlay = (id = 17) => ({
  fapiGameId: 'source-game', gameId: 123, playId: id, quarter: 1, gameClock: '10:21', down: 2, yardsToGo: 7,
  visitorTeamAbbr: 'BAL', homeTeamAbbr: 'BUF', playDescriptionNoTime: 'Charting test play',
});
const response = plays => ({ count: plays.length, plays });
function rows(charting = {}, capturedAt = at) {
  const player = (id, position) => ({ gsisId: `00-${id}`, nflId: String(id), playerName: `Test ${id}`, position });
  return collector.participation(sourcePlay(), {
    homeIsOffense: false,
    home: ['DT', 'DT', 'DE', 'DE', 'LB', 'LB', 'CB', 'CB', 'CB', 'S', 'S'].map((position, i) => player(i + 12, position)),
    away: ['QB', 'RB', 'TE', 'WR', 'WR', 'WR', 'C', 'G', 'G', 'T', 'T'].map((position, i) => player(i + 1, position)),
  }, url, capturedAt, { charting_method: 'filtered-playlists', charting_captured_at: capturedAt, ...charting });
}
function play() {
  return normalizePlay({ game_id: '2026_09_BAL_BUF', play_id: 17, qtr: 1, time: '10:21',
    down: 2, ydstogo: 7, posteam: 'BAL', defteam: 'BUF', play_type: 'pass', pass: 1, desc: 'Charting test play' });
}
function withImports(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-charting-'));
  try { callback(directory, (name, data) => fs.writeFileSync(path.join(directory, `nflpro-${name}.csv`), schema.csv(data))); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('filter membership captures explicit true and false, retaining unknown plays instead of complementing positive results', () => {
  const field = schema.CHARTING_FIELDS.find(field => field.key === 'motion');
  const plays = [sourcePlay(17), sourcePlay(18), sourcePlay(19)];
  const values = collector.chartingField(plays, new Map([
    ['1', response([plays[0]])], ['0', response([plays[1]])],
  ]), url, field);
  assert.deepEqual([...values], [['17', 'true'], ['18', 'false']]);
  assert.equal(values.has('19'), false);
  assert.equal(collector.chartingField(plays, new Map([['1', response([])], ['0', response([])]]), url, field).size, 0);
});

test('filter capture rejects ignored filters, overlaps, truncated results and plays outside the base playlist', () => {
  const field = schema.CHARTING_FIELDS.find(field => field.key === 'motion');
  const plays = [sourcePlay()];
  for (const responses of [
    new Map([['1', response(plays)], ['0', response(plays)]]),
    new Map([['1', { count: 2, plays }], ['0', response([])]]),
    new Map([['1', response([sourcePlay(99)])], ['0', response([])]]),
    new Map([['1', response([{ ...sourcePlay(), fapiGameId: 'other-game' }])], ['0', response([])]]),
  ]) assert.throws(() => collector.chartingField(plays, responses, url, field), /overlapping|complete|outside|inconsistent/);
});

test('v2 charting round-trips with source metadata while the app still accepts original v1 CSVs', () => {
  const data = rows({ qb_alignment: 'Pistol', motion: 'false', blitz: 'true', box_category: 'Light (<7)' });
  const parsed = parseCSV(schema.csv(data));
  assert.equal(schema.validate(parsed.rows, parsed.header).length, 1);
  assert.deepEqual(schema.charting(parsed.rows[0]).motion, {
    value: false, capturedAt: at, method: 'filtered-playlists', sourceGameId: 'source-game', sourcePlayId: '17',
  });
  const legacy = data.map(row => Object.fromEntries(schema.LEGACY_COLUMNS.map(column => [column, column === 'schema_version' ? '1' : row[column]])));
  assert.equal(schema.validate(legacy, schema.LEGACY_COLUMNS).length, 1);
  assert.deepEqual(schema.charting(legacy[0]), {});
  assert.throws(() => schema.validate(data, schema.LEGACY_COLUMNS), /charting CSV columns/);
});

test('v2 rejects ambiguous encodings, invented counts, inconsistent per-play charting, and missing provenance', () => {
  for (const bad of [
    { motion: '0' }, { blitz: '2' }, { box_category: '6' }, { qb_alignment: 'Guess' },
    { motion: 'true', charting_method: '' }, { motion: 'true', charting_captured_at: '' },
  ]) assert.throws(() => schema.validate(rows(bad)), /Invalid participation/);
  const inconsistent = rows({ motion: 'true' });
  inconsistent[0].motion = 'false';
  assert.throws(() => schema.validate(inconsistent), /Conflicting situation/);
});

test('FTN remains authoritative including false and zero; NFL Pro fills missing fields without translating categories or flags into counts', () => {
  const p = play();
  advanced.attach(p, null, {
    qb_location: 'S', is_motion: 'FALSE', n_pass_rushers: '4', n_blitzers: '0', n_defense_box: '6',
  });
  const captured = rows({ qb_alignment: 'Under center', motion: 'true', play_action: 'false',
    blitz: 'true', pressure: 'false', box_category: 'Stacked (8+)', defensive_personnel_group: 'Dime' });
  advanced.attachNFLProCharting(p, schema.charting(captured[0]));
  assert.equal(p.charting.qbLocation, 'Shotgun');
  assert.equal(p.charting.motion, false);
  assert.equal(p.charting.playAction, false);
  assert.equal(p.charting.box, 6);
  assert.equal(p.charting.rushers, 4);
  assert.equal(p.charting.blitzers, 0);
  assert.equal(p.charting.blitz, true);
  assert.equal(p.charting.pressure, false);
  assert.equal(p.charting.boxCategory, 'Stacked (8+)');
  assert.equal(p.charting.defPersonnelGroup, 'Dime');
  assert.equal(p.chartingSources.motion, 'FTN');
  assert.equal(p.chartingSources.playAction, 'NFL Pro / NGS');
  assert.deepEqual(p.chartingConflicts.motion, { source: 'FTN', value: false, nflPro: true });
  assert.equal(p.nflProCharting.values.qbLocation, 'Under center');
  const onlyPro = play();
  advanced.attachNFLProCharting(onlyPro, schema.charting(captured[0]));
  for (const key of ['box', 'blitzers', 'rushers', 'rpo', 'screen', 'noHuddle', 'backfield', 'coverage']) {
    assert.equal(onlyPro.charting[key], undefined);
  }
  assert.match(advanced.tags(onlyPro).join(' '), /NGS blitz: Yes/);
  assert.match(advanced.tags(onlyPro).join(' '), /NGS pressure: No/);
  advanced.attachNFLProCharting(onlyPro, schema.charting(rows({ motion: 'false' }, '2026-11-07T15:00:00Z')[0]));
  assert.equal(onlyPro.charting.motion, false);
  assert.equal(onlyPro.chartingConflicts, undefined, 'an updated NFL Pro fallback does not conflict with its own previous value');
  const kick = { ...play(), playType: 'kickoff', flags: {} };
  advanced.attachNFLProCharting(kick, schema.charting(captured[0]));
  assert.equal(kick.charting, undefined);
});

test('complete participation and latest nonempty charting are selected independently across old/new, partial/full files', () => {
  withImports((_directory, write) => {
    const old = rows().map(row => ({ ...row, schema_version: '1' }));
    write('a-full-v1', old);
    write('b-partial-v2', rows({ motion: 'false', pressure: 'true' }, '2026-11-07T15:00:00Z').slice(0, 2));
    write('c-new-full-v1', old.map(row => ({ ...row, captured_at: '2026-11-08T15:00:00Z' })));
    write('d-new-unknown', rows({}, '2026-11-09T15:00:00Z'));
    const p = play();
    assert.deepEqual(attachImports(_directory, game, [p]), []);
    assert.equal(p.onField.offense.length, 11);
    assert.equal(p.participation.status, 'complete');
    assert.equal(p.charting.motion, false);
    assert.equal(p.charting.pressure, true);
    assert.equal(p.nflProCharting.provenance.motion.capturedAt, '2026-11-07T15:00:00Z');
    write('e-new-correction', rows({ motion: 'true' }, '2026-11-10T15:00:00Z'));
    const updated = play();
    assert.deepEqual(attachImports(_directory, game, [updated]), []);
    assert.equal(updated.charting.motion, true);
    assert.equal(updated.charting.pressure, true);
  });
});

test('equal-time contradictory captures reject the conflicting file without losing previously valid data', () => {
  withImports((directory, write) => {
    write('a-good', rows({ motion: 'false' }));
    write('b-conflict', rows({ motion: 'true', pressure: 'true' }));
    const p = play();
    assert.match(attachImports(directory, game, [p]).join(' '), /Conflicting NFL Pro charting/);
    assert.equal(p.charting.motion, false);
    assert.equal(p.charting.pressure, undefined);
  });
});

test('a later conflicting play rejects all earlier charting updates from that file atomically', () => {
  withImports((directory, write) => {
    const second = data => data.map(row => ({ ...row, source_play_id: '18' }));
    write('a-good', [...rows({ motion: 'false' }), ...second(rows({ motion: 'false' }))]);
    write('b-conflict', [
      ...rows({ motion: 'true', pressure: 'true' }, '2026-11-07T15:00:00Z'),
      ...second(rows({ motion: 'true' })),
    ]);
    const plays = [play(), { ...play(), playId: 18 }];
    assert.match(attachImports(directory, game, plays).join(' '), /Conflicting NFL Pro charting/);
    for (const p of plays) {
      assert.equal(p.charting.motion, false);
      assert.equal(p.charting.pressure, undefined);
    }
  });
});

test('historical participation alignment retains its own source and takes precedence over NFL Pro', () => {
  const p = play();
  advanced.attach(p, { offense_formation: 'UNDER CENTER' }, null);
  advanced.attachNFLProCharting(p, schema.charting(rows({ qb_alignment: 'Shotgun' })[0]));
  assert.equal(p.charting.qbLocation, 'Under center');
  assert.equal(p.chartingSources.qbLocation, 'nflverse participation');
  assert.deepEqual(p.chartingConflicts.qbLocation, {
    source: 'nflverse participation', value: 'Under center', nflPro: 'Shotgun',
  });
});

test('disagreements are surfaced and both sources, missing values, false flags, and provenance survive data exports', () => {
  withImports((directory, write) => {
    write('charting', rows({ motion: 'true', pressure: 'false', box_category: 'Neutral (7)' }));
    const p = play();
    advanced.attach(p, null, { is_motion: 'FALSE' });
    assert.match(attachImports(directory, game, [p]).join(' '), /Existing values retained/);
    const report = { ...reports.mergeOptions(), plays: [p, play()], matchup: 'BAL at BUF', team: 'BAL' };
    for (const layout of ['plays', 'players']) {
      const csv = parseCSV(reports.analysisCsv(report, layout));
      assert.equal(csv.rows[0].Motion, 'No');
      assert.equal(csv.rows[0]['NGS pressure'], 'No');
      assert.equal(csv.rows[0]['NGS box category'], 'Neutral (7)');
      assert.equal(JSON.parse(csv.rows[0]['Charting sources']).motion, 'FTN');
      assert.equal(JSON.parse(csv.rows[0]['NFL Pro charting and provenance']).values.motion, true);
      assert.equal(JSON.parse(csv.rows[0]['Charting disagreements (existing value retained)']).motion.nflPro, true);
      assert.equal(csv.rows.at(-1)['NGS pressure'], '');
    }
  });
});

test('NGS-only preset choices round-trip across games without inventing exact charting', () => {
  const choices = { blitz: 'false', pressure: 'true', boxCategory: 'Light (<7)', defPersonnelGroup: 'Nickel' };
  const preset = presets.capture('NGS', { ...presets.emptyFilter(), offense: 'BAL', choices }, 'BAL', 'BUF');
  assert.deepEqual(presets.restore(preset, 'JAX', 'TEN').choices, choices);
});
