'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const detection = require('../src/shared/detection');

const SIDELINE = -0.1;
const ENDZONE = 0.45;

/** Builds scene candidates and finest-level classified clips from [duration, orientation, cut score] segments. */
function film(segments) {
  const candidates = [];
  let t = 0;
  segments.forEach(([duration, , score], i) => {
    if (i) candidates.push({ time: t, score });
    t += duration;
  });
  const fineClips = detection.clipsAtThreshold(candidates, t, detection.MIN_CUT_THRESHOLD)
    .map((clip, i) => ({ ...clip, orient: segments[i][1] }));
  return { candidates, fineClips, duration: t };
}

const play = (cutScore = 0.3, halfCutScore = 0.3) => [[12, SIDELINE, cutScore], [12, ENDZONE, halfCutScore]];

test('automatic detection lowers the threshold when weak cuts hide plays', () => {
  const segments = Array.from({ length: 12 }, (_, i) => play(0.3, i % 3 === 0 ? 0.045 : 0.3)).flat();
  const choice = detection.chooseCutThreshold({ ...film(segments), filmWeights: Array(12).fill(1) });
  assert.equal(choice.threshold, 0.04, 'the least sensitive level that still finds every weak cut');
  assert.equal(choice.pairs.length, 12);
  assert.equal(choice.tuning.linked, 12);
  assert.equal(choice.tuning.surePlays, 12);
  assert.ok(choice.tuning.levels.find((level) => level.threshold === 0.1).pairs < 12);
});

test('automatic detection keeps the standard threshold when extra sensitivity only adds noise', () => {
  const segments = [];
  for (let i = 0; i < 12; i++) {
    segments.push([12, SIDELINE, 0.3]);
    // Weak flashes inside every third end zone clip look like an extra play at low thresholds.
    if (i % 3 === 0) segments.push([10, ENDZONE, 0.3], [5, SIDELINE, 0.05], [5, ENDZONE, 0.05]);
    else segments.push([12, ENDZONE, 0.3]);
  }
  const choice = detection.chooseCutThreshold({ ...film(segments), filmWeights: Array(12).fill(1) });
  assert.equal(choice.threshold, 0.1);
  assert.equal(choice.pairs.length, 12);
  assert.ok(choice.tuning.levels.find((level) => level.threshold === 0.03).unusedPairs > 0);
  const merged = choice.clips.find((clip) => clip.estimated);
  assert.ok(merged.orient > 0, 'merged clips inherit duration-weighted end zone orientation');
});

test('automatic detection needs play-by-play weights', () => {
  assert.equal(detection.validWeights([1, 0.5, 0]), true);
  assert.equal(detection.validWeights([0, 0]), false);
  assert.equal(detection.validWeights([1, 2]), false);
  assert.throws(() => detection.chooseCutThreshold({ ...film(play()), filmWeights: [] }), /play-by-play/);
});
