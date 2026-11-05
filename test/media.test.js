'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const media = require('../src/main/media');
const { ffmpegPath } = require('../src/main/ffpaths');
const { features } = require('../src/shared/orientation');

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('shared limiter bounds concurrent jobs, releases failed slots, and cancels queued jobs', async () => {
  const limit = media.createLimiter(2);
  const pending = [];
  let active = 0, peak = 0;
  const job = () => limit(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => pending.push(resolve));
    active--;
  });
  const a = job(), b = job(), c = job();
  await tick();
  assert.equal(pending.length, 2);
  pending.shift()();
  await a;
  await tick();
  assert.equal(pending.length, 2);
  for (const resolve of pending.splice(0)) resolve();
  await Promise.all([b, c]);
  assert.equal(peak, 2);

  const controller = new AbortController();
  const serial = media.createLimiter(1);
  let release;
  const blocking = serial(() => new Promise((resolve) => { release = resolve; }));
  let called = false;
  const cancelled = serial(() => { called = true; }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, { cancelled: true });
  await tick();
  release();
  await blocking;
  await assert.rejects(serial(() => { throw new Error('Failure'); }), /Failure/);
  assert.equal(await serial(() => 42), 42);
  assert.equal(called, false);
  assert.throws(() => media.createLimiter(0), /Invalid concurrency/);
});

test('mapLimit preserves order and waits for active work before reporting a failure', async () => {
  let release, finished = false, started = 0;
  const running = media.mapLimit([0, 1, 2, 3], 2, async (value) => {
    started++;
    if (value === 0) throw new Error('Stop');
    await new Promise((resolve) => { release = resolve; });
    finished = true;
  });
  await tick();
  assert.equal(started, 2);
  assert.equal(finished, false);
  release();
  await assert.rejects(running, /Stop/);
  assert.equal(finished, true);
  assert.deepEqual(await media.mapLimit([3, 1, 2], 2, async (n) => n * 2), [6, 2, 4]);
  await assert.rejects(media.mapLimit([], 0, () => {}), /Invalid concurrency/);
});

test('cancelled commands never spawn and short clips respect cancellation', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(media.run('not-a-real-executable', [], { signal }), { cancelled: true });
  await assert.rejects(media.classifyClips('unused', [{ duration: 0.1 }], { signal }), { cancelled: true });
});

test('native batched samples match separate seeks, and full analysis records phase times', {
  skip: process.env.A22_TEST_MEDIA !== '1', timeout: 60000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-media-'));
  try {
    const file = path.join(dir, 'samples.mp4');
    await media.run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=320x180:rate=30:duration=6', '-c:v', 'libx264', '-threads', '1',
      '-g', '60', '-bf', '2', '-pix_fmt', 'yuv420p', file]);
    for (const times of [[0, 0.034], [0.35, 1.65], [2.345, 3.789], [5.8, 5.95]]) {
      const batch = await media.grabGraySamples(file, times);
      const separate = await Promise.all(times.map((time) => media.grabGray(file, time)));
      for (let i = 0; i < times.length; i++) assert.deepEqual(batch[i], separate[i], `sample ${times[i]}`);
    }
    const clips = [{ index: 0, start: 0, duration: 6 }, { index: 1, start: 1, duration: 0.5 }];
    const warnings = [], progress = [];
    await media.classifyClips(file, clips, { onWarning: (w) => warnings.push(w), onProgress: (f) => progress.push(f) });
    const samples = await Promise.all([2.1, 3.9].map((time) => media.grabGray(file, time)));
    const expected = Math.round(samples.reduce((n, frame) => n + features(frame, 320, 180).score, 0) / 2 * 1000) / 1000;
    assert.equal(clips[0].orient, expected);
    assert.equal(clips[1].orient, null);
    assert.deepEqual(warnings, []);
    assert.equal(progress.at(-1), 1);
    const phases = [];
    const result = await media.analyzeFilm(file, { onProgress: (p) => phases.push(p.phase) });
    assert.equal(phases.at(-1), 'done');
    for (const key of ['probeMs', 'scanMs', 'classifyMs', 'pairMs', 'totalMs']) {
      assert.ok(Number.isFinite(result.timings[key]) && result.timings[key] >= 0, key);
    }
    assert.ok(result.timings.totalMs >= result.timings.scanMs + result.timings.classifyMs);
    assert.deepEqual(result.warnings, []);
    const fallbackWarnings = [];
    const truncated = [{ index: 0, start: 5, duration: 2 }];
    await media.classifyClips(file, truncated, { onWarning: (w) => fallbackWarnings.push(w) });
    assert.ok(fallbackWarnings.length >= 2);
    assert.equal(typeof truncated[0].orient, 'number', 'valid first sample survives a missing second sample');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
