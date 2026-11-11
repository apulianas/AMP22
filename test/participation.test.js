'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const schema = require('../src/shared/participation');
const { parseCSV } = require('../src/shared/csv');
const { attachImports } = require('../src/main/participation');
const collector = require('../extensions/nflpro/collector');
const advanced = require('../src/shared/advanced');
const reports = require('../src/shared/reports');
const { normalizePlay, category } = require('../src/shared/plays');
const analysis = require('../src/shared/analysis');

const game = { season: 2026, gameType: 'REG', week: 9, awayTeam: 'BAL', homeTeam: 'BUF' };
function state() {
  const player = (i, position) => ({ nflId: String(100 + i), gsisId: `00-${i}`, playerName: `Player ${i}`, uniformNumber: i, position });
  return { film: {
    selectedPlay: { fapiGameId: 123, gameId: 'source-game', playId: 17, week: 9, quarter: 1, gameClock: '10:21',
      down: 2, yardsToGo: 7, visitorTeamAbbr: 'BAL', homeTeamAbbr: 'BUF', playDescriptionNoTime: 'Test play' },
    selectedPlayExpanded: { requestKey: '123-17', homeIsOffense: false,
      away: ['QB', 'RB', 'TE', 'WR', 'WR', 'WR', 'C', 'G', 'G', 'T', 'T'].map((p, i) => player(i + 1, p)),
      home: ['DT', 'DT', 'DE', 'DE', 'LB', 'LB', 'CB', 'CB', 'FS', 'SS', 'CB'].map((p, i) => player(i + 12, p)) },
  } };
}
function rows() {
  return collector.snapshot(state(), 'https://pro.nfl.com/film/plays?gameId=source-game&season=2026&seasonType=REG&weekSlug=WEEK_9',
    '2026-11-06T15:00:00.000Z');
}
function play(patch = {}) {
  return normalizePlay({ game_id: '2026_09_BAL_BUF', play_id: 17, qtr: 1, time: '10:21',
    down: 2, ydstogo: 7, posteam: 'BAL', defteam: 'BUF', play_type: 'pass', pass: 1, desc: 'Test play', ...patch });
}

test('collector exports only verified participation fields, waits for matching expanded play, and assigns home/away correctly', () => {
  const s = state();
  s.auth = { token: 'must-not-export' };
  const captured = rows();
  assert.equal(captured.length, 22);
  assert.equal(captured[0].side, 'defense');
  assert.equal(captured[0].team, 'BUF');
  assert.equal(captured[11].side, 'offense');
  assert.deepEqual(Object.keys(captured[0]).sort(), schema.COLUMNS.slice().sort());
  assert.ok(!JSON.stringify(captured).includes('must-not-export'));
  s.film.selectedPlayExpanded.requestKey = '123-16';
  assert.throws(() => collector.snapshot(s, 'https://pro.nfl.com/film/plays'), /finish loading/);
  s.film.selectedPlayExpanded.requestKey = '123-17';
  s.film.selectedPlay.gameId = 'other-game';
  assert.throws(() => collector.snapshot(s, 'https://pro.nfl.com/film/plays?gameId=source-game'), /different game/);
});

test('CSV schema round-trips and rejects duplicate identities, games, oversized sides and mismatched metadata', () => {
  const original = rows();
  const parsed = parseCSV(schema.csv(original));
  assert.equal(schema.validate(parsed.rows, parsed.header).length, 1);
  assert.throws(() => schema.validate([...original, original[0]]), /Duplicate player/);
  assert.throws(() => schema.validate(original.map((r, i) => i ? r : { ...r, week: '8' })), /more than one game/);
  assert.throws(() => schema.validate(original.map((r, i) => i ? r : { ...r, down: '3' })), /Conflicting situation/);
  assert.throws(() => schema.validate(original, ['name']), /columns/);
  assert.throws(() => schema.validate([...original, { ...original[0], source_player_id: 'extra', gsis_id: 'extra' }]), /More than 11/);
  assert.throws(() => schema.validate(original.map((r) => ({ ...r, clock: '16:00' }))), /Invalid/);
});

test('matching verifies situations even for identical IDs and never matches by ordinal position', () => {
  const original = rows();
  assert.equal(schema.match(original, [play()]).playId, 17);
  assert.equal(schema.match(original, [play({ play_id: 99 })]).playId, 99);
  assert.equal(schema.match(original, [play({ time: '10:20' })]), null);
  assert.equal(schema.match(original, [play({ posteam: 'BUF' })]), null);
  assert.equal(schema.match(original, [play({ play_id: 98 }), play({ play_id: 99 })]), null);
});

test('kickoffs match receiving-team possession, not extra points at the same clock, including different provider IDs', () => {
  const description = 'K.Kicker kicks 65 yards from BLT 35 to BUF 0. R.Returner to BUF 23 for 23 yards.';
  const captured = rows().map((r) => ({
    ...r, source_play_id: '18', down: '', yards_to_go: '0', description,
  }));
  const extraPoint = play({ down: '', ydstogo: 0, play_type: 'extra_point', pass: 0,
    desc: 'K.Kicker extra point is GOOD.' });
  const kickoff = play({ play_id: 18, down: '', ydstogo: 0, play_type: 'kickoff', pass: 0,
    posteam: 'BUF', defteam: 'BAL',
    desc: '39-K.Kicker kicks 65 yards from BAL 35 to BUF 0. 26-R.Returner to BUF 23 for 23 yards.' });
  assert.equal(schema.match(captured, [extraPoint, kickoff]), kickoff);
  assert.equal(schema.match(captured, [extraPoint]), null);
  assert.equal(schema.match(captured.map((r) => ({ ...r, source_play_id: '17' })), [extraPoint, kickoff]), kickoff);
  const anotherKickoff = { ...kickoff, playId: 19, desc: kickoff.desc.replace('BUF 23', 'BUF 35') };
  assert.equal(schema.match(captured.map((r) => ({ ...r, source_play_id: '99' })),
    [extraPoint, kickoff, anotherKickoff]), kickoff);
  assert.equal(schema.match(captured.map((r) => ({ ...r, clock: '10:20' })), [kickoff]), null);
  assert.equal(schema.match(captured.map((r) => ({ ...r, description: '' })), [kickoff]), null);
  assert.equal(schema.match(captured.map((r) => ({ ...r, down: '1' })), [kickoff]), null);
  assert.equal(schema.match(captured, [{ ...kickoff, playId: 19 }, { ...kickoff, playId: 20 }]), null);
});

test('same-clock kickoff and extra-point imports stay separate and exported players retain their actual teams', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-kickoffs-'));
  try {
    const extraRows = rows().map((r) => ({
      ...r, down: '', yards_to_go: '0', description: 'K.Kicker extra point is GOOD.',
    }));
    const kickRows = extraRows.map((r) => ({
      ...r, source_play_id: '18', description: 'K.Kicker kicks 65 yards from BAL 35 to BUF 0.',
    }));
    const extraPoint = play({ down: '', ydstogo: 0, play_type: 'extra_point', pass: 0, desc: extraRows[0].description });
    const kickoff = play({ play_id: 18, down: '', ydstogo: 0, play_type: 'kickoff', pass: 0,
      posteam: 'BUF', defteam: 'BAL', desc: kickRows[0].description });
    fs.writeFileSync(path.join(dir, 'nflpro-game.csv'), schema.csv([...extraRows, ...kickRows]));
    assert.deepEqual(attachImports(dir, game, [extraPoint, kickoff]), []);
    assert.equal(extraPoint.participation.sourcePlayId, '17');
    assert.equal(kickoff.participation.sourcePlayId, '18');
    assert.equal(extraPoint.onField.offense[0].id, extraRows.find((r) => r.team === 'BAL').gsis_id);
    assert.equal(kickoff.onField.offense[0].id, kickRows.find((r) => r.team === 'BUF').gsis_id);
    assert.equal(kickoff.onField.defense[0].id, kickRows.find((r) => r.team === 'BAL').gsis_id);
    assert.equal(kickoff.personnel, undefined);
    assert.equal(category(extraPoint), 'special');
    assert.equal(category(kickoff), 'special');
    const wide = parseCSV(reports.analysisCsv({ ...reports.mergeOptions(), plays: [extraPoint, kickoff] })).rows;
    assert.deepEqual(wide.map((r) => r['Play type']), ['extra_point', 'kickoff']);
    const exported = parseCSV(reports.analysisCsv({ ...reports.mergeOptions(), plays: [kickoff] }, 'players')).rows;
    assert.equal(exported.length, 22);
    for (const row of exported) {
      assert.equal(row['Player team'], kickRows.find((r) => r.gsis_id === row['GSIS player ID']).team);
      assert.equal(row['Play type'], 'kickoff');
    }
    fs.writeFileSync(path.join(dir, 'nflpro-game.csv'), schema.csv(kickRows.filter((r) => r.side === 'offense').slice(0, 2)));
    const partial = { ...kickoff, onField: { offense: [], defense: Array.from({ length: 11 }, (_, i) => ({ id: `historic-${i}` })) } };
    assert.deepEqual(attachImports(dir, game, [partial]), []);
    assert.equal(partial.onField.defense[0].id, 'historic-0');
    assert.equal(partial.participation.defenseSource, 'nflverse');
    assert.equal(partial.onField.offense.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('local imports reload updated files, preserve charting, infer packages, ignore other games, and surface invalid files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-participation-'));
  try {
    const filename = path.join(dir, 'nflpro-game.csv');
    fs.writeFileSync(filename, schema.csv(rows()));
    const p = play();
    p.charting = { box: 6, rushers: 5, blitzers: 0, motion: false };
    assert.deepEqual(attachImports(dir, game, [p]), []);
    assert.equal(p.onField.offense.length, 11);
    assert.equal(p.participation.status, 'complete');
    assert.equal(p.personnel.offense, '11');
    assert.equal(p.personnel.defense, 'Nickel');
    assert.equal(p.personnel.inferred, true);
    assert.equal(p.charting.box, 6);
    assert.equal(p.charting.blitzers, 0);
    const updated = rows().map((r) => ({ ...r, name: `${r.name} updated`, captured_at: '2026-11-06T16:00:00Z' }));
    fs.writeFileSync(filename, schema.csv(updated));
    const again = play();
    attachImports(dir, game, [again]);
    assert.match(again.onField.offense[0].name, /updated/);
    const other = play();
    attachImports(dir, { ...game, week: 8 }, [other]);
    assert.equal(other.onField, undefined);
    fs.writeFileSync(path.join(dir, 'nflpro-bad.csv'), 'bad\nrow');
    assert.match(attachImports(dir, game, [play()]).join(), /columns/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('partial imports retain historical players and supplied personnel, and unknown positions do not infer zero counts', () => {
  const p = play();
  p.onField = { offense: rows().filter((r) => r.side === 'offense').map((r) => ({ id: r.gsis_id, position: r.position })),
    defense: [] };
  p.personnel = { offense: '12', defense: 'Dime' };
  advanced.inferPersonnel(p);
  assert.equal(p.personnel.offense, '12');
  assert.equal(p.inferredPersonnel.offense, '11');
  p.onField.offense[0].position = 'UNKNOWN';
  advanced.inferPersonnel(p);
  assert.equal(p.inferredPersonnel.offense, '');
  p.onField.offense[0].position = 'QB';
  p.onField.offense[3].position = 'T';
  advanced.inferPersonnel(p);
  assert.equal(p.inferredPersonnel.offense, '12 (6)');
  assert.equal(p.personnel.offense, '12 (6)', 'complete extra-OL evidence refines supplied packages');
});

test('extra-OL imports share package labels across Analysis Lab and both data-export layouts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-extra-ol-'));
  try {
    for (const [extra, expected] of [[1, '12 (6)'], [2, '13 (7)'], [3, '14 (8)']]) {
      const captured = rows().map(r => r.side === 'offense' && Number(r.jersey_number) >= 4 &&
        Number(r.jersey_number) < 4 + extra ? { ...r, position: 'T' } : r);
      fs.writeFileSync(path.join(dir, 'nflpro-game.csv'), schema.csv(captured));
      const p = play();
      p.personnel = { offense: '11' };
      assert.deepEqual(attachImports(dir, game, [p]), []);
      assert.equal(p.personnel.offense, expected);
      const summary = analysis.summarize([p], { group: 'offense', split: 'none' });
      assert.equal(summary.rows[0].label, `${expected}*`);
      assert.equal(analysis.summarize([p], { split: 'offense' }).rows[0].series, `${expected}*`);
      assert.ok(analysis.summarize([p], { group: 'matchup' }).rows[0].label.startsWith(`${expected}* vs `));
      assert.match(analysis.csv({ title: 'Extra OL', subtitle: '', notes: '', metric: 'ypp', chart: 'bars',
        rows: summary.rows }), new RegExp(expected.replace(/[()]/g, '\\$&')));
      for (const layout of ['plays', 'players']) {
        const exported = parseCSV(reports.analysisCsv({ ...reports.mergeOptions(), plays: [p] }, layout)).rows;
        assert.ok(exported.every(r => r['Offensive personnel'] === expected));
        assert.ok(exported.every(r => r['Inferred offensive personnel'] === expected));
      }
      assert.equal(p.onField.offense.filter(x => x.position === 'T').length, 2 + extra);
      p.onField.offense.find(x => x.number === '4').position = 'WR';
      advanced.inferPersonnel(p);
      assert.equal(p.personnel.offense, extra === 1 ? '11' : `1${extra} (${4 + extra})`,
        'refreshed inferred labels do not retain an old lineman count');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('partial import does not replace a historical side and warns on unmatched source plays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-partial-'));
  try {
    fs.writeFileSync(path.join(dir, 'nflpro-partial.csv'), schema.csv(rows().slice(0, 2)));
    const p = play();
    p.onField = { offense: [], defense: Array.from({ length: 11 }, (_p, i) => ({ id: `historic-${i}`, name: 'Historical defender', position: 'CB' })) };
    assert.deepEqual(attachImports(dir, game, [p]), []);
    assert.equal(p.onField.defense[0].id, 'historic-0');
    assert.equal(p.participation.defenseSource, 'nflverse');
    assert.equal(p.participation.status, 'partial');
    assert.match(attachImports(dir, game, [play({ time: '10:20' })]).join(), /could not be matched/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('complete captures survive newer partial files and colliding source-play mappings reject the entire file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-completeness-'));
  try {
    fs.writeFileSync(path.join(dir, 'nflpro-full.csv'), schema.csv(rows()));
    fs.writeFileSync(path.join(dir, 'nflpro-partial.csv'), schema.csv(rows().slice(0, 2).map((r) => ({
      ...r, captured_at: '2026-11-07T15:00:00Z',
    }))));
    const p = play();
    attachImports(dir, game, [p]);
    assert.equal(p.participation.status, 'complete');
    assert.equal(p.onField.offense.length, 11);
    fs.unlinkSync(path.join(dir, 'nflpro-full.csv'));
    fs.unlinkSync(path.join(dir, 'nflpro-partial.csv'));
    fs.writeFileSync(path.join(dir, 'nflpro-collision.csv'), schema.csv([
      ...rows().map((r) => ({ ...r, source_play_id: '98' })),
      ...rows().map((r) => ({ ...r, source_play_id: '99' })),
    ]));
    const collision = play();
    assert.match(attachImports(dir, game, [collision]).join(), /Multiple source plays/);
    assert.equal(collision.onField, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('analysis CSV includes participation with advanced stats in wide and player layouts, retaining missing plays', () => {
  const p = play();
  p.charting = { box: 6, rushers: 5, blitzers: 0, motion: false };
  p.onField = { offense: [{ id: '00-1', sourceId: '101', name: '=formula', position: 'QB', number: '1' }], defense: [] };
  const report = { ...reports.mergeOptions(), plays: [p, play({ play_id: 18 })], matchup: 'BAL at BUF', team: 'BAL' };
  const wide = parseCSV(reports.analysisCsv(report));
  assert.equal(wide.rows[0]['Offense player IDs'], '00-1');
  assert.equal(wide.rows[0]['Box count'], '6');
  assert.equal(wide.rows[0].Blitzers, '0');
  assert.equal(wide.rows[0].Motion, 'No');
  assert.equal(wide.rows[1]['Offense player IDs'], '');
  const long = parseCSV(reports.analysisCsv(report, 'players'));
  assert.equal(long.rows.length, 2);
  assert.equal(long.rows[0]['GSIS player ID'], '00-1');
  assert.equal(long.rows[0]['Player name'], "'=formula");
  assert.equal(long.rows[1]['GSIS player ID'], '');
  assert.equal(long.rows[0]['nflverse game ID'], '2026_09_BAL_BUF');
  assert.throws(() => reports.analysisCsv(report, 'bad'), /layout/);
});
