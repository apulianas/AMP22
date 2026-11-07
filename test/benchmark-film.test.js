'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { options } = require('../scripts/benchmark-film');

test('benchmark defaults do not request decoder or filter overrides', () => {
  const o = options(['game.mp4', '--out', 'new-results']);
  assert.equal(o.mode, 'full');
  assert.equal(o.threads, 'auto');
  assert.equal(o.filterThreads, 'auto');
  assert.equal(o.scanFilterThreads, undefined);
  assert.equal(o.hardware, 'none');
  assert.equal(o.batch, undefined);
});

test('scan filter experiment is independent of decoder and extraction options', () => {
  const o = options(['game.mp4', '--out', 'new-results', '--scan-filter-threads', '2']);
  assert.equal(o.scanFilterThreads, '2');
  assert.equal(o.threads, 'auto');
  assert.equal(o.filterThreads, 'auto');
});

test('benchmark parses staged scans and independent batch experiments', () => {
  assert.equal(options(['game.mp4', '--out', 'x', '--mode', 'scan', '--seconds', '180', '--start', '2400']).start, '2400');
  const o = options(['game.mp4', '--out', 'x', '--mode', 'classify', '--analysis', 'baseline.json', '--batch', '--samples', '40']);
  assert.equal(o.batch, true);
  assert.equal(o.samples, '40');
});

test('benchmark rejects invalid or misleading configurations', () => {
  for (const args of [
    [], ['game.mp4'], ['game.mp4', '--out'], ['game.mp4', '--out', 'x', '--wat', '2'],
    ['game.mp4', '--out', 'x', '--threads', '0'],
    ['game.mp4', '--out', 'x', '--threads', '-1'],
    ['game.mp4', '--out', 'x', '--scan-filter-threads', 'NaN'],
    ['game.mp4', '--out', 'x', '--samples', '2.5'],
    ['game.mp4', '--out', 'x', '--hardware', 'cuda'],
    ['game.mp4', '--out', 'x', '--mode', 'classify'],
    ['game.mp4', '--out', 'x', '--seconds', '180'],
    ['game.mp4', '--out', 'x', '--mode', 'scan', '--batch'],
  ]) assert.throws(() => options(args));
});
