'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sc = require('../src/shared/scenes');

test('parses ffmpeg metadata=print output from stderr', () => {
  const log = [
    '[Parsed_metadata_2 @ 0x600] frame:0    pts:1001  pts_time:0.0166833',
    '[Parsed_metadata_2 @ 0x600] lavfi.scene_score=0.012000',
    '[Parsed_metadata_2 @ 0x600] frame:1    pts:780780 pts_time:13.0173',
    '[Parsed_metadata_2 @ 0x600] lavfi.scene_score=0.432100',
    'frame=  100 fps=0.0 q=-0.0 size=N/A',
  ].join('\n');
  assert.deepEqual(sc.parseMetadataLog(log), [
    { time: 0.0166833, score: 0.012 },
    { time: 13.0173, score: 0.4321 },
  ]);
});

test('line splitter handles chunk boundaries and CR', () => {
  const lines = [];
  const s = sc.createLineSplitter((l) => lines.push(l));
  s.push('ab');
  s.push('c\r\nde\rf');
  s.push('g\n');
  s.push('tail');
  s.end();
  assert.deepEqual(lines, ['abc', 'de', 'fg', 'tail']);
});

test('cutsFromScores applies threshold and merges near-duplicates keeping the strongest', () => {
  const cuts = sc.cutsFromScores([
    { time: 0, score: 0.9 }, // t=0 is never a cut
    { time: 5, score: 0.05 },
    { time: 10, score: 0.3 },
    { time: 10.2, score: 0.6 },
    { time: 20, score: 0.12 },
  ], { threshold: 0.1, minGap: 0.4 });
  assert.deepEqual(cuts.map((c) => c.time), [10.2, 20]);
});

test('clipsFromCuts covers the whole film', () => {
  const clips = sc.clipsFromCuts([10, 25, 25, 99], 40);
  assert.deepEqual(clips.map((c) => [c.start, c.end]), [[0, 10], [10, 25], [25, 40]]);
  assert.deepEqual(clips.map((c) => c.index), [0, 1, 2]);
});

test('parseRate', () => {
  assert.ok(Math.abs(sc.parseRate('60000/1001') - 59.94) < 0.001);
  assert.equal(sc.parseRate('30'), 30);
  assert.equal(sc.parseRate('0/0'), null);
  assert.equal(sc.parseRate(''), null);
});
