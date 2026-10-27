'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/shared/plays');

function row(o) {
  return Object.assign({
    play_id: '1', game_id: '2026_01_BAL_IND', qtr: '1', time: '15:00', down: '1', ydstogo: '10', yrdln: 'BAL 25',
    posteam: 'BAL', defteam: 'IND', desc: 'x', play_type: 'run', yards_gained: '3',
  }, o);
}
const play = (o) => P.normalizePlay(row(o));

test('air yards retain positive, negative, and zero values without filling missing values', () => {
  assert.ok(P.PBP_COLUMNS.includes('air_yards'));
  for (const value of ['39', '-3', '0']) {
    assert.equal(play({ air_yards: value }).airYards, Number(value));
  }
  for (const value of ['', 'NA', null, undefined, 'invalid', 'Infinity']) {
    assert.equal(play({ air_yards: value }).airYards, null);
  }
  for (const flags of [{ complete_pass: '1' }, { incomplete_pass: '1' }, { interception: '1' }]) {
    assert.equal(play({ play_type: 'pass', air_yards: '20', ...flags }).airYards, 20);
  }
});

test('primary headshot player: runner, caught pass, sack, interception or defensive fumble recovery', () => {
  const primary = (fields) => P.primaryPlayer(play(fields));
  assert.deepEqual(primary({ rusher_player_name: 'D.Henry', rusher_player_id: '00-0032764' }), { id: '00-0032764', name: 'D.Henry', role: 'rusher' });
  assert.deepEqual(primary({ play_type: 'pass', complete_pass: '1', receiver_player_name: 'Z.Flowers', receiver_player_id: '00-0039064' }), { id: '00-0039064', name: 'Z.Flowers', role: 'receiver' });
  assert.equal(primary({ play_type: 'pass', receiver_player_name: 'Z.Flowers', incomplete_pass: '1' }), null);
  const sack = { play_type: 'pass', sack: '1', sack_player_name: 'B.Mafe', sack_player_id: '00-0038133', rusher_player_name: 'L.Jackson' };
  assert.equal(primary(sack).role, 'sacker');
  assert.equal(primary({ play_type: 'pass', sack: '1', half_sack_1_player_name: 'B.Mafe', half_sack_1_player_id: '00-0038133' }).id, '00-0038133');
  assert.equal(primary({ ...sack, interception: '1', interception_player_name: 'M.Humphrey', interception_player_id: '00-0033281' }).role, 'interceptor');
  assert.equal(primary({ fumble_lost: '1', fumble_recovery_1_player_name: 'M.Humphrey', fumble_recovery_1_player_id: '00-0033281', fumble_recovery_1_team: 'CIN' }).role, 'recoverer');
  assert.equal(primary({ fumble_lost: '1', fumble_recovery_1_player_name: 'D.Henry', fumble_recovery_1_team: 'BAL',
    fumble_recovery_2_player_name: 'M.Humphrey', fumble_recovery_2_player_id: '00-0033281', fumble_recovery_2_team: 'CIN' }).role, 'recoverer2');
  assert.equal(primary({ ...sack, play_type: 'no_play' }), null);
  assert.equal(primary({ interception: '1', rusher_player_name: 'D.Henry' }), null);
  assert.equal(primary({ rusher_player_name: 'D.Henry' }).id, '');
});

test('categories', () => {
  assert.equal(P.category(play({ play_type: 'run' })), 'run');
  assert.equal(P.category(play({ play_type: 'qb_kneel' })), 'run');
  assert.equal(P.category(play({ play_type: 'pass' })), 'pass');
  assert.equal(P.category(play({ play_type: 'kickoff' })), 'special');
  assert.equal(P.category(play({ play_type: 'no_play', pass: '1' })), 'pass');
  assert.equal(P.category(play({ play_type: 'no_play', rush: '1' })), 'run');
  assert.equal(P.category(play({ play_type: 'no_play', desc: 'PENALTY on BAL, False Start, 5 yards - No Play.' })), 'penalty');
  assert.equal(P.category(play({ play_type: 'no_play', desc: '8-R.Sanchez punts 50 yards. PENALTY ...' })), 'special');
});

test('film weights: snaps 1, pre-snap penalties uncertain', () => {
  assert.equal(P.filmWeight(play({ play_type: 'pass' })), 1);
  assert.equal(P.filmWeight(play({ play_type: 'no_play', desc: 'False Start' })), 0.5);
});

test('non-plays are filtered out', () => {
  const rows = [
    row({ play_type: '', desc: 'GAME' }),
    row({ play_type: 'kickoff' }),
    row({ play_type: 'no_play', desc: 'Timeout #1 by BAL at 03:12.', timeout: '1' }),
    row({ play_type: 'no_play', desc: 'Two-Minute Warning' }),
    row({ play_type: 'run' }),
    row({ play_type: '', desc: 'END QUARTER 1' }),
  ];
  assert.deepEqual(P.gamePlays(rows).map((p) => p.playType), ['kickoff', 'run']);
});

test('key play reasons', () => {
  assert.deepEqual(P.keyReasons(play({ play_type: 'pass', interception: '1', yards_gained: '0' })), ['INT']);
  assert.deepEqual(P.keyReasons(play({ play_type: 'run', touchdown: '1', yards_gained: '1' })), ['TD']);
  assert.deepEqual(P.keyReasons(play({ play_type: 'run', yards_gained: '12' })), ['BIG']);
  assert.deepEqual(P.keyReasons(play({ play_type: 'run', yards_gained: '9' })), []);
  assert.deepEqual(P.keyReasons(play({ play_type: 'pass', yards_gained: '19' })), []);
  assert.deepEqual(P.keyReasons(play({ play_type: 'pass', yards_gained: '20' })), ['BIG']);
  assert.deepEqual(P.keyReasons(play({ play_type: 'field_goal', field_goal_result: 'made' })), ['FG']);
  assert.deepEqual(P.keyReasons(play({ play_type: 'pass', fumble_lost: '1', yards_gained: '-7', sack: '1' })), ['FUM']);
  assert.deepEqual(P.keyReasons(play({ play_type: 'pass', yards_gained: '-7', sack: '1' }), { sacks: true }), ['SACK']);
  assert.deepEqual(P.keyReasons(play({ play_type: 'run', yards_gained: '12' }), { runYards: 15 }), []);
  // Nullified plays are never key.
  assert.deepEqual(P.keyReasons(play({ play_type: 'no_play', pass: '1', touchdown: '1', yards_gained: '40' })), []);
});

test('down & distance and clock labels', () => {
  assert.equal(P.downDistance(play({ down: '3', ydstogo: '7' })), '3rd & 7');
  assert.equal(P.downDistance(play({ down: '1', ydstogo: '6', yrdln: 'IND 6' })), '1st & Goal');
  assert.equal(P.downDistance(play({ down: '' })), '');
  assert.equal(P.clockLabel(play({ qtr: '5', time: '8:12' })), 'OT 8:12');
  assert.equal(P.clockLabel(play({ qtr: '2', time: ':36' })), 'Q2 :36');
});

test('negative plays: sacks and losses of 3+ yards', () => {
  assert.deepEqual(P.negativeReasons(play({ play_type: 'pass', sack: '1', yards_gained: '-1' })), ['SACK']);
  assert.deepEqual(P.negativeReasons(play({ play_type: 'run', yards_gained: '-3' })), ['LOSS']);
  assert.deepEqual(P.negativeReasons(play({ play_type: 'run', yards_gained: '-2' })), []);
  assert.deepEqual(P.negativeReasons(play({ play_type: 'run', yards_gained: '-5' }), { lossYards: 6 }), []);
  assert.deepEqual(P.negativeReasons(play({ play_type: 'qb_kneel', yards_gained: '-3' })), []);
  assert.deepEqual(P.negativeReasons(play({ play_type: 'no_play', sack: '1', yards_gained: '-8' })), []);
});

test('box score summaries', () => {
  const b = (o) => P.boxScore(play(o));
  assert.deepEqual(b({ play_type: 'pass', passer_player_name: 'T.Huntley', receiver_player_name: 'Z.Flowers', complete_pass: '1', yards_gained: '48', touchdown: '1' }),
    { who: 'T.Huntley → Z.Flowers', yards: '+48', result: 'TD', tone: 'good' });
  assert.equal(b({ play_type: 'pass', passer_player_name: 'J.Burrow', receiver_player_name: 'J.Chase', incomplete_pass: '1', yards_gained: '0' }).result, 'INC');
  assert.equal(b({ play_type: 'pass', passer_player_name: 'J.Burrow', interception: '1', interception_player_name: 'M.Humphrey' }).result, 'INT M.Humphrey');
  const sack = b({ play_type: 'pass', sack: '1', passer_player_name: 'T.Huntley', sack_player_name: 'B.Mafe', yards_gained: '-6' });
  assert.equal(sack.who, 'T.Huntley sacked by B.Mafe');
  assert.equal(sack.yards, '\u22126');
  assert.equal(sack.tone, 'bad');
  assert.deepEqual(b({ play_type: 'run', rusher_player_name: 'D.Henry', yards_gained: '4', first_down: '1' }),
    { who: 'D.Henry', yards: '+4', result: '1st down', tone: 'good' });
  assert.equal(b({ play_type: 'field_goal', kicker_player_name: 'T.Loop', kick_distance: '34', field_goal_result: 'made' }).who, 'T.Loop 34-yd FG');
  assert.equal(b({ play_type: 'kickoff', kicker_player_name: 'T.Loop', kick_distance: '65', touchback: '1' }).result, 'Touchback');
  assert.equal(b({ play_type: 'no_play', penalty: '1', penalty_team: 'BAL', penalty_type: 'False Start', penalty_yards: '5', penalty_player_name: 'R.Stanley' }).who,
    'BAL False Start, 5 yds (R.Stanley)');
});

test('overlay summaries describe rushes and receptions without positive signs and preserve TDs', () => {
  const summary = (fields) => P.overlaySummary(play(fields));
  assert.equal(summary({ rusher_player_name: 'D.Henry', yards_gained: '12' }), 'D.Henry  12 yard rush');
  assert.equal(summary({ rusher_player_name: 'D.Henry', yards_gained: '-3' }), 'D.Henry  -3 yard rush');
  assert.equal(summary({ rusher_player_name: 'D.Henry', yards_gained: '0' }), 'D.Henry  0 yard rush');
  assert.equal(summary({ rusher_player_name: 'D.Henry', yards_gained: '4', touchdown: '1' }), 'D.Henry  4 yard rush  TD');
  const reception = { play_type: 'pass', passer_player_name: 'L.Jackson', receiver_player_name: 'Z.Flowers', complete_pass: '1' };
  assert.equal(summary({ ...reception, yards_gained: '48', touchdown: '1' }), 'L.Jackson → Z.Flowers  48 yard reception  TD');
  assert.equal(summary({ ...reception, yards_gained: '-2' }), 'L.Jackson → Z.Flowers  -2 yard reception');
  assert.equal(summary({ ...reception, yards_gained: '0' }), 'L.Jackson → Z.Flowers  0 yard reception');
  assert.equal(summary({ ...reception, yards_gained: '' }), 'L.Jackson → Z.Flowers  reception');
  assert.match(summary({ play_type: 'pass', sack: '1', passer_player_name: 'L.Jackson', yards_gained: '-6' }), /sacked  −6$/);
  assert.equal(summary({ ...reception, complete_pass: '0', incomplete_pass: '1' }), 'L.Jackson → Z.Flowers  INC');
  assert.match(summary({ ...reception, complete_pass: '0', interception: '1' }), /INT$/);
  assert.doesNotMatch(summary({ play_type: 'no_play', rush: '1', penalty: '1' }), /yard rush/);
});

test('drive fields prefer fixed_drive', () => {
  const p = play({ drive: '3', fixed_drive: '4', fixed_drive_result: 'Punt', drive_play_count: '6' });
  assert.equal(p.driveNum, 4);
  assert.equal(p.driveResult, 'Punt');
  assert.equal(p.drivePlays, 6);
});
