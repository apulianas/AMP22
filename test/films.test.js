'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/shared/films');

const files = [
  'w1@Colts/ColtsA22.mp4', 'w1@Colts/wk1colts.mp4',
  'w2vSaints/SaintsA22.mp4', 'w5@Falcons/falconsA22.mp4',
  'w7vBengals/bengalsA22.mp4', 'w7vBengals/wk7bengals.mp4',
];

test('detects A22 names and week tokens', () => {
  assert.ok(f.isA22Name('x/ColtsA22.mp4'));
  assert.ok(f.isA22Name('All-22 week 3.mp4'));
  assert.ok(!f.isA22Name('A22 folder/wk1colts.mp4'));
  assert.deepEqual(f.weekTokens('w7vBengals/bengalsA22.mp4'), [7]);
  assert.deepEqual(f.weekTokens('Week 12/file.mp4'), [12]);
});

test('ranks the A22 file for the selected game first', () => {
  const r = f.rankCandidates(files, { week: 7, opponent: 'CIN', season: 2026 });
  assert.equal(r.ranked[0].path, 'w7vBengals/bengalsA22.mp4');
  assert.equal(r.auto, 'w7vBengals/bengalsA22.mp4');
  assert.equal(f.rankCandidates(files, { week: 1, opponent: 'IND' }).auto, 'w1@Colts/ColtsA22.mp4');
});

test('no auto pick when nothing matches the week', () => {
  assert.equal(f.rankCandidates(files, { week: 9, opponent: 'PIT' }).auto, null);
});
