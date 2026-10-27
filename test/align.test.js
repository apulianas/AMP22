'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { alignPlays, alignSegment } = require('../src/shared/align');

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
