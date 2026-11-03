'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { alignPlays, alignSegment, alignSplitPlays, filmRole } = require('../src/shared/align');

const P = (w = 1) => ({ filmWeight: w });

test('one pair per play when counts match', () => {
  assert.deepEqual(alignPlays([P(), P(), P()], 3, {}), [0, 1, 2]);
});

test('pre-snap penalty is left without film when the film has no clip for it', () => {
  assert.deepEqual(alignPlays([P(), P(0.5), P(), P()], 3, {}), [0, null, 1, 2]);
});

test('pre-snap penalty gets a clip when the film has one for it', () => {
  assert.deepEqual(alignPlays([P(), P(0.5), P(), P()], 4, {}), [0, 1, 2, 3]);
});

test('extra film pairs are left unmatched, preferring the edges', () => {
  assert.deepEqual(alignPlays([P(), P()], 3, {}), [0, 1]);
});

test('anchors force a play onto a pair and re-align around it', () => {
  const plays = [P(), P(), P(), P()];
  // Film has one extra clip; user links play 2 to pair 3.
  const m = alignPlays(plays, 5, new Map([[2, 3]]));
  assert.equal(m[2], 3);
  assert.equal(m[3], 4);
  assert.ok(m[0] < m[1] && m[1] < 3);
});

test('anchor null marks a play as having no film', () => {
  assert.deepEqual(alignPlays([P(), P(), P()], 3, { 1: null }), [0, null, 1]);
});

test('non-monotonic and out-of-range anchors are ignored', () => {
  const m = alignPlays([P(), P(), P(), P()], 4, new Map([[1, 3], [2, 1], [3, 99]]));
  assert.equal(m[1], 3);
  assert.notEqual(m[2], 1);
});

test('alignSegment with no pairs maps nothing', () => {
  assert.deepEqual(alignSegment([1, 1], 0), [null, null]);
});

const snap = (posteam, cat = 'run', weight = 1) => ({
  posteam, defteam: posteam === 'BAL' ? 'BUF' : 'BAL', cat, filmWeight: weight,
});
const splitPairs = (offense, defense) => [
  ...Array.from({ length: offense }, () => ({ role: 'offense' })),
  ...Array.from({ length: defense }, () => ({ role: 'defense' })),
];

test('split files align independently in game order from the selected team perspective', () => {
  const plays = [snap('BAL'), snap('BAL', 'special'), snap('BUF'), snap('BAL'), snap('BUF')];
  assert.deepEqual(alignSplitPlays(plays, splitPairs(2, 2), 'BAL'), [0, null, 2, 1, 3]);
  assert.deepEqual(alignSplitPlays(plays, splitPairs(2, 2), 'BUF'), [2, null, 0, 3, 1]);
  assert.equal(filmRole(snap('BAL'), 'BAL'), 'offense');
  assert.equal(filmRole(snap('BAL'), 'BUF'), 'defense');
  assert.equal(filmRole(snap('BAL'), 'KC'), null);
  assert.equal(filmRole(snap('BAL', 'other'), 'BAL'), null);
  assert.equal(filmRole(snap('BAL', 'special'), 'BAL'), 'special');
});

test('split corrections and missing clips do not shift the other unit', () => {
  const plays = [snap('BAL'), snap('BUF'), snap('BAL', 'penalty', 0.5), snap('BUF'), snap('BAL')];
  const pairs = splitPairs(2, 2);
  assert.deepEqual(alignSplitPlays(plays, pairs, 'BAL'), [0, 2, null, 3, 1]);
  assert.deepEqual(alignSplitPlays(plays, pairs, 'BAL', new Map([[0, null]])), [null, 2, 0, 3, 1]);
  assert.deepEqual(alignSplitPlays(plays, pairs, 'BAL', new Map([[0, 2], [1, 0]])), [0, 2, null, 3, 1]);
  assert.deepEqual(alignSplitPlays(plays, splitPairs(0, 2), 'BAL'), [null, 0, null, 1, null]);
  assert.deepEqual(alignSplitPlays(plays, splitPairs(2, 0), 'BAL'), [0, null, null, null, 1]);
});

test('split anchors are translated from combined indices into the correct file', () => {
  const plays = [snap('BAL'), snap('BUF'), snap('BAL'), snap('BUF')];
  assert.deepEqual(alignSplitPlays(plays, splitPairs(3, 3), 'BAL', new Map([[0, 1], [1, 4]])), [1, 4, 2, 5]);
});

test('special teams use their own stream for both teams and never shift offense or defense', () => {
  const plays = [snap('BAL', 'special'), snap('BAL'), snap('BUF', 'special'), snap('BUF'), snap('BAL', 'special')];
  const pairs = [...splitPairs(1, 1), { role: 'special' }, { role: 'special' }, { role: 'special' }];
  assert.deepEqual(alignSplitPlays(plays, pairs, 'BAL'), [2, 0, 3, 1, 4]);
  assert.deepEqual(alignSplitPlays(plays, pairs, 'BUF'), [2, 1, 3, 0, 4]);
  assert.deepEqual(alignSplitPlays(plays, pairs, 'BAL', new Map([[0, null]])), [null, 0, 2, 1, 3]);
});
