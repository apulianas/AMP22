'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { features, normalizeScores } = require('../src/shared/orientation');

function stripes(w, h, fn) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = fn(x, y) ? 230 : 60;
  return g;
}

test('horizontal lines (end zone view) score positive', () => {
  const f = features(stripes(160, 90, (x, y) => y % 12 < 2), 160, 90);
  assert.ok(f.score > 0.8, `score ${f.score}`);
});

test('vertical / diagonal lines (sideline view) score negative or low', () => {
  assert.ok(features(stripes(160, 90, (x) => x % 12 < 2), 160, 90).score < -0.8);
  const diag = features(stripes(160, 90, (x, y) => (2 * x + y) % 16 < 3), 160, 90).score;
  assert.ok(diag < 0.2, `diag ${diag}`);
});

test('blank frame has no edges', () => {
  const f = features(new Uint8Array(160 * 90).fill(100), 160, 90);
  assert.equal(f.edges, 0);
  assert.equal(f.score, 0);
});

test('normalizeScores maps the two clusters to about -1 / +1', () => {
  const vals = [-0.2, -0.1, -0.15, 0.4, 0.5, 0.45, null];
  const { normalized } = normalizeScores(vals);
  assert.ok(normalized.slice(0, 3).every((v) => v < -0.5));
  assert.ok(normalized.slice(3, 6).every((v) => v > 0.5));
  assert.equal(normalized[6], 0);
  assert.deepEqual(normalizeScores([1, 2]).normalized, [0, 0]);
});
