'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexDepthCharts, chartForGame } = require('../src/main/depthcharts');
const advanced = require('../src/shared/advanced');
const reports = require('../src/shared/reports');
const { parseCSV } = require('../src/shared/csv');
const { normalizePlay } = require('../src/shared/plays');

const HEADER = 'dt,team,gsis_id,pos_abb,pos_rank\n';
const game = { season: 2026, gameType: 'REG', week: 9, gameday: '2026-11-05' };
const chartRow = (id, position, rank = 1, date = '2026-11-05T15:23:13Z', team = 'BAL') =>
  `${date},${team},${id},${position},${rank}`;

test('depth charts select the latest game-date snapshot per team without future or previous-team leakage', () => {
  const index = indexDepthCharts(HEADER + [
    chartRow('00-1', 'RT', 1, '2026-11-04T15:00:00Z'),
    chartRow('00-1', 'LT'), chartRow('00-1', 'RT', 1, '2026-11-06T15:00:00Z'),
    chartRow('00-1', 'RG', 1, undefined, 'JAX'),
  ].join('\n'));
  const bal = chartForGame(index, game, 'BAL');
  assert.equal(bal.asOf, '2026-11-05T15:23:13Z');
  assert.deepEqual([...bal.players.get('00-1').positions], ['LT']);
  assert.deepEqual([...chartForGame(index, game, 'JAX').players.get('00-1').positions], ['RG']);
  assert.equal(chartForGame(index, { ...game, gameday: '2026-11-03' }, 'BAL'), null);
  assert.equal(chartForGame(index, { ...game, gameday: '' }, 'BAL'), null);
  assert.equal(chartForGame(index, game, 'BUF'), null);
  const invalid = indexDepthCharts(HEADER + [chartRow('00-1', 'LT', 1, ''), chartRow('NA', 'LT')].join('\n'));
  assert.equal(chartForGame(invalid, game, 'BAL'), null);
});

test('only unique best-rank compatible positions are inferred; source positions, explicit sides and identities stay unchanged', () => {
  const index = indexDepthCharts(HEADER + [
    chartRow('00-1', 'LT'), chartRow('00-1', 'RT', 2),
    chartRow('00-2', 'LG', 2), chartRow('00-2', 'RG', 2),
    chartRow('00-3', 'RG', 1), chartRow('00-3', 'C', 2),
    chartRow('00-4', 'RT'), chartRow('00-5', 'RG', 1, undefined, 'JAX'),
    chartRow('00-6', 'RT'), chartRow('', 'LT'),
  ].join('\n'));
  const players = [
    { id: '00-1', name: 'Tackle', position: 'T' }, { id: '00-2', position: 'G' },
    { id: '00-3', position: 'G' }, { id: '00-4', position: 'LT' },
    { id: '00-5', position: 'G' }, { id: '00-6', position: 'G' }, { name: 'Tackle', position: 'T' },
  ];
  const original = structuredClone(players);
  const play = { posteam: 'BAL', onField: { offense: players, defense: [{ id: '00-1', position: 'T' }] } };
  advanced.attachDepthPositions(play, new Map([['BAL', chartForGame(index, game, 'BAL')]]));
  assert.equal(players[0].positionInference.position, 'LT');
  assert.equal(players[0].positionInference.source, 'nflverse/ESPN depth chart');
  assert.equal(players[0].positionInference.asOf, '2026-11-05T15:23:13Z');
  assert.equal(players[2].positionInference.position, 'RG');
  for (const i of [1, 3, 4, 5, 6]) assert.equal(players[i].positionInference, undefined);
  assert.equal(play.onField.defense[0].positionInference, undefined);
  assert.deepEqual(players.map(({ positionInference, ...raw }) => raw), original);
  advanced.attachDepthPositions(play, new Map());
  assert.ok(players.every(p => !p.positionInference), 'a later refresh cannot retain obsolete inference');
});

test('historical charts require the exact season, week, game type and team and handle playoff round labels', () => {
  const index = indexDepthCharts('season,club_code,week,game_type,gsis_id,depth_position,depth_team\n' + [
    '2024,BAL,1,REG,00-1,LG,1', '2024,BAL,2,REG,00-1,RG,1',
    '2024,BAL,1,POST,00-1,RT,1', '2023,BAL,1,REG,00-1,LT,1',
  ].join('\n'));
  assert.deepEqual([...chartForGame(index, { season: 2024, week: 1, gameType: 'REG' }, 'BAL').players.get('00-1').positions], ['LG']);
  const post = chartForGame(index, { season: 2024, week: 1, gameType: 'WC' }, 'BAL');
  assert.deepEqual([...post.players.get('00-1').positions], ['RT']);
  assert.equal(post.asOf, '2024 POST week 1');
  assert.equal(post.source, 'nflverse depth chart');
  assert.equal(chartForGame(index, { season: 2024, week: 3, gameType: 'REG' }, 'BAL'), null);
  assert.throws(() => indexDepthCharts('name,position\nSomeone,LT\n'), /Unsupported depth-chart/);
});

test('on-field ordering preserves positions, separates FB, groups defensive roles and retains unknowns and specialists', () => {
  const offense = ['RT', 'QB', 'C', 'WR', 'LG', 'RB', 'LT', 'TE', 'RG', 'FB', 'WR', 'OL', 'K', '?']
    .map((position, i) => ({ id: `00-${i}`, position, number: String(i + 1) }));
  const defense = ['SS', 'CB', 'MLB', 'OLB', 'NT', 'DE', 'FS', 'DT', 'ILB', 'LB', 'DL', 'P', '?']
    .map((position, i) => ({ id: `00-${i}`, position, number: String(i + 1) }));
  const play = { onField: { offense, defense } };
  assert.deepEqual(advanced.orderedPlayers(play, 'offense').map(p => p.position),
    ['WR', 'WR', 'RB', 'FB', 'TE', 'QB', 'LT', 'LG', 'C', 'RG', 'RT', 'OL', 'K', '?']);
  assert.deepEqual(advanced.orderedPlayers(play, 'defense').map(p => p.position),
    ['DE', 'NT', 'DT', 'DL', 'OLB', 'MLB', 'ILB', 'LB', 'CB', 'SS', 'FS', 'P', '?']);
  assert.equal(offense[0].position, 'RT', 'display sorting does not mutate source lists');
  assert.equal(defense[0].position, 'SS');
  assert.deepEqual(advanced.orderedPlayers({}, 'offense'), []);
});

function eligiblePlay() {
  return normalizePlay({ game_id: '2026_09_JAX_BAL', play_id: 1, posteam: 'BAL', defteam: 'JAX',
    play_type: 'run', rush: 1, desc: '76-C.Vinson reported in as eligible. 22-D.Henry up the middle.' });
}
function eligibleRoster() {
  return ['T', 'T', 'G', 'G', 'C', 'T', 'QB', 'RB', 'FB', 'WR', 'TE']
    .map((position, i) => ({ id: `00-${i}`, position, name: `Player ${i}`, number: String(i ? i : 76) }));
}

test('only an explicitly reported unique eligible extra lineman moves between TE and QB', () => {
  const play = eligiblePlay();
  play.onField = { offense: eligibleRoster(), defense: [{ id: 'def', position: 'T', number: '76' }] };
  advanced.annotateEligible(play);
  const ordered = advanced.orderedPlayers(play, 'offense');
  assert.equal(advanced.displayPosition(play.onField.offense[0]), 'OL-E');
  assert.equal(play.onField.offense[0].position, 'T');
  assert.equal(ordered.findIndex(p => p.eligibleReceiver), ordered.findIndex(p => p.position === 'TE') + 1);
  assert.equal(ordered.findIndex(p => p.position === 'QB'), ordered.findIndex(p => p.eligibleReceiver) + 1);
  assert.equal(play.onField.defense[0].eligibleReceiver, undefined);
  advanced.inferPersonnel(play);
  assert.equal(play.inferredPersonnel.offense, '', 'six OL do not become an ordinary personnel package');
  play.desc = 'No eligible announcement.';
  advanced.annotateEligible(play);
  assert.ok(play.onField.offense.every(p => !p.eligibleReceiver));
  play.desc = '76-C.Vinson reported in as eligible.';
  play.onField.offense[1].number = '76';
  advanced.annotateEligible(play);
  assert.ok(play.onField.offense.every(p => !p.eligibleReceiver), 'ambiguous jersey numbers are not guessed');
  play.onField.offense = play.onField.offense.filter(p => p.id !== '00-1');
  advanced.annotateEligible(play);
  assert.ok(play.onField.offense.every(p => !p.eligibleReceiver), 'do not invent a sixth OL on a five-OL list');
});

test('analysis CSV preserves raw position and adds separately labelled inference provenance and eligibility', () => {
  const play = eligiblePlay();
  play.onField = { offense: eligibleRoster(), defense: [] };
  advanced.annotateEligible(play);
  play.onField.offense[1].positionInference = { position: 'RT', source: 'nflverse/ESPN depth chart', asOf: '2026-11-05T15:23:13Z' };
  const report = { plays: [play] };
  const wide = parseCSV(reports.analysisCsv(report)).rows[0];
  assert.equal(wide['Offense player positions'].split(';')[1], 'T');
  assert.equal(wide['Offense inferred player positions'].split(';')[1], 'RT');
  assert.equal(wide['Offense position inference sources'].split(';')[1], 'nflverse/ESPN depth chart');
  assert.equal(wide['Offense position inference as of'].split(';')[1], '2026-11-05T15:23:13Z');
  assert.equal(wide['Offense reported eligible player IDs'], '00-0');
  const rows = parseCSV(reports.analysisCsv(report, 'players')).rows;
  assert.equal(rows[0]['Reported eligible'], 'Yes');
  assert.equal(rows[1]['Reported eligible'], '', 'missing announcement is not proof of ineligibility');
  assert.equal(rows[1]['Player position'], 'T');
  assert.equal(rows[1]['Inferred player position'], 'RT');
  assert.equal(rows[1]['Position inference source'], 'nflverse/ESPN depth chart');
  assert.equal(rows[1]['Position inference as of'], '2026-11-05T15:23:13Z');
});
