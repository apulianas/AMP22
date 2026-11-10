'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const T = require('../src/shared/tracking');
const { validateAnalysis, analyze } = require('../src/main/tracking');
const H = require('../src/main/highlight-export');
const { mergeSettings } = require('../src/shared/settings');
const { segmentArgs, exportClips } = require('../src/main/export');
const { run, probe } = require('../src/main/media');
const { ffmpegPath } = require('../src/main/ffpaths');

const track = patch => ({
  ...T.DEFAULTS, name: 'Selected player', id: null, snap: null,
  points: [{ t: 10, x: 0.3, y: 0.5 }, { t: 10.1, x: 0.4, y: 0.6 }], ...patch,
});

test('highlight defaults are opt-in, validated, and persisted without importing or analyzing film', () => {
  const settings = mergeSettings({ highlightDefaults: { mode: 'presnap', radius: 0.05, showName: false, showPhoto: false } });
  assert.deepEqual(settings.highlightDefaults, { mode: 'presnap', radius: 0.05, showName: false, showPhoto: false });
  assert.deepEqual(mergeSettings({ highlightDefaults: { mode: 'bad', radius: 5, showPhoto: 'yes' } }).highlightDefaults, T.DEFAULTS);
  assert.equal(Object.hasOwn(settings.highlightDefaults, 'enabled'), false);
  assert.equal(T.validateTrack(track()).name, 'Selected player');
  for (const patch of [
    { radius: 0 }, { radius: Infinity }, { name: null }, { id: '../../photo' },
    { showPhoto: 'true' }, { snap: -1 }, { points: [{ t: -1, x: 0.4, y: 0.5 }] },
    { points: [{ t: 0, x: 1.1, y: 0.5 }] },
    { points: [{ t: 0, x: 0.1, y: 0.2 }, { t: 0, x: 0.3, y: 0.4 }] },
  ]) assert.throws(() => T.validateTrack(track(patch)), /Invalid/);
});

test('tracking requests bound computation to one explicitly requested clip and up to eleven offensive seeds', () => {
  const request = { file: '/film.mp4', start: 10, len: 8, seeds: [{ x: 0.5, y: 0.5 }] };
  assert.equal(validateAnalysis(request), request);
  for (const patch of [{ len: 61 }, { start: -1 }, { len: 0 }, { seeds: [] }, { seeds: Array(13).fill({ x: 0.5, y: 0.5 }) }, { seeds: [{ x: 0, y: 1 }] }]) {
    assert.throws(() => validateAnalysis({ ...request, ...patch }), /Choose a player/);
  }
});

test('positions interpolate only within tracked spans and do not invent a track across gaps', () => {
  const points = track().points;
  assert.equal(T.position(points, 9.9), null);
  assert.ok(Math.abs(T.position(points, 10.05).x - 0.35) < 1e-8);
  assert.equal(T.position(points, 10.2), null);
  assert.equal(T.position([...points, { t: 12, x: 0.7, y: 0.2 }], 11), null);
  assert.equal(T.visible(track({ mode: 'presnap' }), 10), false);
  assert.equal(T.visible(track({ mode: 'presnap', snap: 10.5 }), 10.4), true);
  assert.equal(T.visible(track({ mode: 'presnap', snap: 10.5 }), 10.5), false);
});

test('snap suggestions require a settled baseline, camera evidence, and sustained movement from several marked players', () => {
  const settled = Array.from({ length: 5 }, (_, i) => ({ t: i / 10 + 0.1, camera: true, speeds: [0, 0, 0, 0, 0] }));
  const moving = [{ t: 0.6, camera: true, speeds: [2, 2, 2, 2, 0] }, { t: 0.7, camera: true, speeds: [2, 2, 2, 2, 0] }];
  assert.deepEqual(T.suggestSnap([...settled, ...moving], 5), { time: 0.5, confidence: 'higher', players: 5 });
  assert.equal(T.suggestSnap(moving, 5), null);
  assert.equal(T.suggestSnap([...settled, moving[0]], 5), null);
  assert.equal(T.suggestSnap([...settled, ...moving].map(s => ({ ...s, camera: false })), 5), null);
  assert.equal(T.suggestSnap([...settled, ...moving].map(s => ({ ...s, speeds: [2, 0, 0, 0, 0] })), 5), null);
  assert.equal(T.suggestSnap([...settled, ...moving].map(s => ({ ...s, speeds: [2, null, 2, 2, 2] })), 5), null);
  assert.equal(T.suggestSnap([...settled, ...moving], 2), null);
});

test('camera compensation resolves shared image translation and does not invent motion from blank frames', () => {
  const width = 240, height = 150;
  const previous = new Uint8Array(width * height), next = new Uint8Array(width * height);
  let state = 23;
  for (let i = 0; i < previous.length; i++) { state = state * 16807 % 2147483647; previous[i] = state % 256; }
  for (let y = 0; y < height - 3; y++) for (let x = 0; x < width - 5; x++) next[(y + 3) * width + x + 5] = previous[y * width + x];
  assert.deepEqual(T.cameraShift(previous, next, width, height, []), { x: 5, y: 3 });
  assert.equal(T.patchMotion(previous, next, width, height, { x: 100, y: 80 }, { x: 5, y: 3 }), 0);
  assert.ok(T.patchMotion(previous, next, width, height, { x: 100, y: 80 }, { x: 0, y: 0 }) > 20);
  assert.equal(T.cameraShift(new Uint8Array(width * height), next, width, height, []), null);
});

test('export geometry respects source letterboxing and both portrait layouts', () => {
  const info = { width: 1920, height: 1080 };
  assert.deepEqual(T.geometry('sideline', 'sideline', info, false), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(T.geometry('both', 'sideline', info, false).y, 0);
  assert.equal(T.geometry('both', 'endzone', info, false).y, 608);
  assert.equal(T.geometry('both', 'sideline', info, true).y, 352);
  assert.equal(T.geometry('both', 'endzone', info, true).y, 960);
  assert.equal(T.geometry('sideline', 'sideline', { width: 1440, height: 1080 }, false).x, 240);
});

test('highlight export uses absolute angle times, clips trims, and stops pre-snap graphics at the snap', () => {
  const value = track({ mode: 'presnap', snap: 10.075 });
  const intervals = T.intervals(value, 10.025, 2);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].from, 0);
  assert.ok(Math.abs(intervals[0].to - 0.05) < 1e-8);
  assert.deepEqual(T.intervals(track({ mode: 'presnap' }), 10, 1), []);
  const clip = { aStart: 10, bStart: 20, len: 1, highlights: { sideline: value, endzone: track({ points: [{ t: 20, x: 0.5, y: 0.5 }] }) } };
  const info = { width: 1920, height: 1080 };
  assert.equal(H.descriptors(clip, 'sideline', info, false).length, 1);
  assert.equal(H.descriptors(clip, 'endzone', info, false)[0].start, 20);
  assert.equal(H.descriptors(clip, 'both', info, false).length, 2);
  assert.equal(H.descriptors({ ...clip, aStart: 11 }, 'sideline', info, false).length, 0);
});

test('clean exports skip highlight inputs and filters even when annotations are present', () => {
  const clip = { aStart: 10, bStart: 20, len: 1 };
  const marker = { track: track({ graphic: { anchorX: 20, anchorY: 20 } }), start: 10, geometry: { x: 0, y: 0, w: 1920, h: 1080 } };
  marker.intervals = T.intervals(marker.track, 10, 1);
  const args = segmentArgs('/film.mp4', clip, 'sideline', false, 30, true, 0, undefined, [marker]);
  assert.equal(args.includes('highlight-0.png'), false);
  assert.equal(args[args.indexOf('-filter_complex') + 1].includes('overlay='), false);
});

test('real Jaguars long-play regression: #44 survives the pre-snap stance and follows the route before overlap', {
  skip: !process.env.A22_TEST_TRACKING_FILM, timeout: 120000,
}, async () => {
  const start = 74.089999;
  const result = await analyze({
    file: process.env.A22_TEST_TRACKING_FILM, start, len: 24.9,
    seeds: [{ x: 0.2650862068965517, y: 0.22306034482758622 }],
  });
  assert.ok(result.points.length >= 150, `Expected at least 15s, not the original 0.4s failure; got ${result.points.length} positions.`);
  const route = T.position(result.points, start + 14);
  // Manually inspected torso location on the supplied Q1 14:17 sideline frame at +14s.
  assert.ok(route && Math.hypot((route.x - 176 / 960) * 960, (route.y - 175 / 540) * 540) < 18);
  assert.ok(Math.abs(route.x - result.points[0].x) > 0.06, 'Follow the moving defender instead of leaving a circle on the initial field location.');
  if (result.points.at(-1).t < start + 24.7) assert.match(result.warnings.join(' '), /lost.*review and correct/);
});

test('native highlight export follows motion, hides after the snap, and honors trims in every layout', {
  skip: process.env.A22_TEST_EXPORT !== '1', timeout: 180000,
}, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'amp22-tracking-'));
  try {
    const film = path.join(temp, 'source.mp4');
    await run(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', film]);
    const image = async (name, width, height, color) => {
      const file = path.join(temp, name + '.png');
      await run(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height},format=rgba`, '-frames:v', '1', '-update', '1', file]);
      return `data:image/png;base64,${(await fs.readFile(file)).toString('base64')}`;
    };
    const marker = await image('marker', 40, 40, 'lime');
    const value = track({
      mode: 'presnap', snap: 1.8,
      points: Array.from({ length: 11 }, (_, i) => ({ t: 1 + i / 10, x: 0.2 + i * 0.04, y: 0.5 })),
      graphic: { dataUrl: marker, width: 40, height: 40, anchorX: 20, anchorY: 20 },
    });
    H.validateHighlights({ sideline: value });
    assert.throws(() => H.validateHighlights({ sideline: { ...value, snap: null } }), /confirm the snap/);
    for (const mode of ['sideline', 'endzone', 'both', 'sideline-first', 'endzone-first']) {
      const dimensions = require('../src/shared/export').dimensions(mode);
      const card = await image('card-' + mode, dimensions.width, dimensions.height, 'black@0');
      const destination = path.join(temp, mode + '.mp4');
      await exportClips({
        file: film, mode, overlaySeconds: 0, overlayPosition: { preset: 'top-left' },
        clips: [{ aStart: 1.2, bStart: 1.2, len: 1, card, highlights: { sideline: value, endzone: value } }],
      }, destination);
      const info = await probe(destination);
      assert.equal(info.width, dimensions.width);
      assert.equal(info.height, dimensions.height);
      const frame = async t => (await run(ffmpegPath(), ['-v', 'error', '-ss', String(t), '-i', destination, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { binary: true })).stdout;
      const early = await frame(0.1), late = await frame(0.8);
      const g = T.geometry(mode === 'both' ? 'both' : 'sideline', 'sideline', { width: 320, height: 180 }, true);
      const pixel = (buffer, x, y) => [...buffer.subarray((Math.round(y) * info.width + Math.round(x)) * 3, (Math.round(y) * info.width + Math.round(x)) * 3 + 3)];
      const earlyPixel = pixel(early, g.x + 0.32 * g.w, g.y + 0.5 * g.h);
      assert.ok(earlyPixel[1] > 170 && earlyPixel[0] < 60, `${mode}: moving highlight appears at trimmed absolute position: ${earlyPixel}`);
      assert.ok(pixel(late, g.x + 0.6 * g.w, g.y + 0.5 * g.h).every(v => v < 30), `${mode}: highlight hides after snap`);
    }
    const result = await analyze({ file: film, start: 0, len: 1, seeds: [{ x: 0.5, y: 0.5 }] });
    assert.equal(result.points.length, 1, 'blank film is not silently tracked');
    assert.equal(result.suggestion, null);
    assert.match(result.warnings.join(' '), /lost/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(analyze({ file: film, start: 0, len: 1, seeds: [{ x: 0.5, y: 0.5 }] }, { signal: controller.signal }), /abort/i);
    const active = new AbortController();
    const running = analyze({ file: film, start: 0, len: 3, seeds: [{ x: 0.5, y: 0.5 }] }, { signal: active.signal });
    const timer = setTimeout(() => active.abort(), 5);
    try { await assert.rejects(running, /cancel|abort/i); }
    finally { clearTimeout(timer); }
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
