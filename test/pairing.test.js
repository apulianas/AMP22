'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pairClips } = require('../src/shared/pairing');

/** Builds a film of plays shown sideline then end zone, each pair the same length. */
function film(lengths, { sideline = -0.1, endzone = 0.45 } = {}) {
  const clips = [];
  let t = 0;
  for (const len of lengths) {
    for (const o of [sideline, endzone]) {
      clips.push({ index: clips.length, start: t, end: t + len, orient: o + (clips.length % 3) * 0.02 });
      t += len;
    }
  }
  return clips;
}
const reindex = (clips) => clips.map((c, i) => ({ ...c, index: i }));

test('pairs alternating sideline/end zone clips', () => {
  const clips = film([13, 15, 12, 18, 10, 14]);
  const pairs = pairClips(clips);
  assert.equal(pairs.length, 6);
  pairs.forEach((p, k) => {
    assert.deepEqual(p.sideline.clips, [2 * k]);
    assert.deepEqual(p.endzone.clips, [2 * k + 1]);
  });
});

test('a spurious cut inside a clip does not shift later pairs', () => {
  const clips = film([13, 15, 12, 18, 10, 14]);
  const ez = clips[3]; // end zone half of pair 1 (15 s) split at 6 s
  const split = reindex([...clips.slice(0, 3), { ...ez, end: ez.start + 6 }, { ...ez, start: ez.start + 6 }, ...clips.slice(4)]);
  const pairs = pairClips(split);
  assert.equal(pairs.length, 6);
  assert.deepEqual(pairs[1].endzone.clips, [3, 4]);
  assert.equal(pairs[5].sideline.start, clips[10].start);
  assert.equal(pairs[5].endzone.start, clips[11].start);
});

test('short intro / graphic clips are skipped', () => {
  const body = film([13, 15, 12, 18]).map((c) => ({ ...c, start: c.start + 2, end: c.end + 2 }));
  const clips = reindex([{ start: 0, end: 2, orient: 0.1 }, ...body]);
  const pairs = pairClips(clips);
  assert.equal(pairs.length, 4);
  assert.equal(pairs[0].sideline.start, 2);
  assert.ok(pairs.every((p) => !p.sideline.clips.includes(0)));
});

test('orientation decides the pairing phase when lengths are ambiguous', () => {
  // All clips the same length: only orientation tells sideline from end zone.
  // A lone end zone clip at the start must not become a sideline half.
  const clips = reindex([{ start: 0, end: 12, orient: 0.45 }, ...film([12, 12, 12]).map((c) => ({ ...c, start: c.start + 12, end: c.end + 12 }))]);
  const pairs = pairClips(clips);
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs.map((p) => p.sideline.clips[0]), [1, 3, 5]);
});
