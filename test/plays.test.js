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
