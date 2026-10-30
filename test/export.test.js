'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { clipRange, selectedIndices, selectionRange, safeFilename, exportFilename, dimensions } = require('../src/shared/export');
const { validateRequest, segmentArgs, exportClips } = require('../src/main/export');
const { run, probe } = require('../src/main/media');
const { ffmpegPath } = require('../src/main/ffpaths');

function cardHeader(mode) {
  const { width, height } = dimensions(mode);
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

const clip = { aStart: 1, bStart: 6, len: 2, card: cardHeader('both') };
const request = (patch = {}) => ({ file: '/film.mp4', mode: 'both', clips: [{ ...clip }], ...patch });

test('export range matches playback padding, cut trim, and saved frame offsets', () => {
  const pair = { sideline: { start: 10, end: 15 }, endzone: { start: 20, end: 24 } };
  const range = clipRange(pair, 60, 6);
  assert.equal(range.aStart, 10.008);
  assert.equal(range.bStart, 20.108);
  assert.ok(Math.abs(range.len - 3.842) < 1e-9);
  assert.ok(clipRange(pair, 60, -6).bStart < 20);
  assert.throws(() => clipRange(pair, 60, 300), /no usable clip/);
  assert.throws(() => clipRange(pair, 0), /Invalid clip timing/);
});

test('selection exports in game order, not click order', () => {
  assert.deepEqual(selectedIndices(new Set([10, 2, 1])), [1, 2, 10]);
  assert.deepEqual(selectedIndices(new Set()), []);
  assert.deepEqual(dimensions('both'), { width: 1080, height: 1920 });
  assert.deepEqual(dimensions('sideline'), { width: 1920, height: 1080 });
  assert.throws(() => dimensions('invalid'), /angle/);
});

test('shift-click selects the entire visible range in either direction', () => {
  const visible = [1, 3, 5, 6, 9];
  assert.deepEqual(selectionRange(visible, 3, 9), [3, 5, 6, 9]);
  assert.deepEqual(selectionRange(visible, 9, 3), [3, 5, 6, 9]);
  assert.deepEqual(selectionRange(visible, 5, 5), [5]);
  assert.deepEqual(selectionRange(visible, -1, 6), [6]);
  assert.deepEqual(selectionRange(visible, 2, 6), [6]);
  assert.deepEqual(selectionRange(visible, 1, 2), []);
});

test('suggested names contain only clock, main player and yards, or a clock range', () => {
  const first = { qtr: 2, time: '08:34', names: { passer: 'L.Jackson', receiver: 'Z.Flowers' }, flags: { complete_pass: true }, yards: 48 };
  const last = { qtr: 3, time: '04:12' };
  assert.equal(exportFilename([first]), 'Q2-08m34s-Z.Flowers-48yds.mp4');
  assert.equal(exportFilename([first, last]), 'Q2-08m34s-to-Q3-04m12s.mp4');
  assert.equal(exportFilename([{ qtr: 5, time: '8:12' }]), 'OT-8m12s.mp4');
  assert.equal(exportFilename([{ ...first, names: { rusher: 'D.Henry' }, yards: 0 }]), 'Q2-08m34s-D.Henry-0yds.mp4');
  assert.equal(exportFilename([{ ...first, flags: {}, yards: -6 }]), 'Q2-08m34s-L.Jackson-minus6yds.mp4');
  assert.equal(exportFilename([{ ...first, names: { kicker: 'T.Loop' }, yards: null }]), 'Q2-08m34s-T.Loop.mp4');
  assert.equal(safeFilename('../clip\\bad:name?*.mp4'), 'clip-bad-name.mp4');
  assert.equal(safeFilename('CON.mp4'), 'AMP22-CON.mp4');
  assert.equal(safeFilename('...'), 'AMP22-clip.mp4');
  assert.ok(exportFilename([{ ...first, names: { rusher: 'A'.repeat(500) } }]).length <= 184);
  assert.ok(safeFilename('x'.repeat(500)).length <= 184);
});

test('export requests reject missing selection, invalid ranges, and invalid cards', () => {
  assert.equal(validateRequest(request()).mode, 'both');
  for (const patch of [{ clips: [] }, { mode: 'bad' }, { file: null }]) {
    assert.throws(() => validateRequest(request(patch)), /Choose/);
  }
  for (const patch of [{ aStart: -1 }, { bStart: NaN }, { len: 0 }, { len: Infinity }]) {
    assert.throws(() => validateRequest(request({ clips: [{ ...clip, ...patch }] })), /timing/);
  }
  for (const card of ['not png', 'data:image/png;base64,AAAA', cardHeader('sideline')]) {
    assert.throws(() => validateRequest(request({ clips: [{ ...clip, card }] })), /image/);
  }
  assert.equal(validateRequest(request({ clean: true, clips: [{ aStart: 1, bStart: 6, len: 2 }] })).clean, true);
  assert.throws(() => validateRequest(request({ clean: 'true' })), /clean export option/);
  assert.throws(() => validateRequest(request({ clean: false, clips: [{ aStart: 1, bStart: 6, len: 2 }] })), /image/);
});

test('clean exports skip the image input and overlay filter in every layout', () => {
  for (const mode of ['sideline', 'endzone', 'both']) {
    for (const hasAudio of [true, false]) {
      const args = segmentArgs('/film.mp4', clip, mode, hasAudio, 30, true);
      const filter = args[args.indexOf('-filter_complex') + 1];
      assert.equal(args.includes('card.png'), false);
      assert.equal(filter.includes('overlay='), false);
      assert.equal(filter.includes('vstack=inputs=2'), mode === 'both');
      if (mode === 'both') assert.ok(filter.includes('pad=1080:1920:0:(oh-ih)/2:color=black'));
      if (!hasAudio) assert.ok(filter.includes(`[${mode === 'both' ? 2 : 1}:a]`));
    }
  }
});

test('encoding uses selected sources, normalized audio, and timed single-angle overlays', () => {
  for (const mode of ['sideline', 'endzone', 'both']) {
    const args = segmentArgs('/film.mp4', clip, mode, true, 30);
    assert.equal(args[args.indexOf('-ss') + 1], mode === 'endzone' ? '6.000000' : '1.000000');
    const filter = args[args.indexOf('-filter_complex') + 1];
    assert.equal(filter.includes('vstack=inputs=2'), mode === 'both');
    assert.equal(filter.includes("enable='lt(t,3)'"), mode !== 'both');
    assert.ok(filter.includes('asetpts=PTS-STARTPTS,apad'));
    assert.ok(args.includes('libx264'));
  }
  const silent = segmentArgs('/film.mp4', clip, 'both', false, 30);
  assert.ok(silent.includes('anullsrc=r=48000:cl=stereo'));
  assert.ok(silent[silent.indexOf('-filter_complex') + 1].includes('[3:a]'));
});

// Opt in to native encoding tests: A22_TEST_EXPORT=1 npm test
test('native export: angles, 9:16 stacking, lower third timing, ordering, audio and cancellation', {
  skip: process.env.A22_TEST_EXPORT !== '1',
  timeout: 180000,
}, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-export-test-'));
  try {
    const file = path.join(temp, 'source.mp4');
    await run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i',
      'color=red:s=320x180:r=10:d=4.5[r];color=blue:s=320x180:r=10:d=4.5[b];color=green:s=320x180:r=10:d=4.5[g];color=yellow:s=320x180:r=10:d=4.5[y];[r][b][g][y]concat=n=4:v=1:a=0',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=18',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
    const cards = {};
    for (const mode of ['sideline', 'endzone', 'both']) {
      const { width, height } = dimensions(mode);
      const png = path.join(temp, `${mode}.png`);
      // An opaque white lower strip makes overlay presence measurable.
      await run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i',
        `color=black@0:s=${width}x${height},format=rgba,drawbox=x=0:y=${mode === 'both' ? 1216 : 760}:w=iw:h=ih:color=white:t=fill:replace=1`,
        '-frames:v', '1', png]);
      cards[mode] = `data:image/png;base64,${(await fs.readFile(png)).toString('base64')}`;
    }
    const frame = async (filePath, t, x, y) => {
      const { stdout } = await run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-ss', String(t), '-i', filePath,
        '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { binary: true });
      assert.equal(stdout.length, 3);
      return [...stdout];
    };
    const isRed = ([r, g, b]) => r > 180 && g < 70 && b < 70;
    const isBlue = ([r, g, b]) => b > 180 && r < 70 && g < 70;
    const isGreen = ([r, g, b]) => g > 80 && r < 70 && b < 70;
    const isYellow = ([r, g, b]) => r > 180 && g > 180 && b < 70;
    const progress = [];
    const landscape = path.join(temp, 'sideline.mp4');
    await exportClips({ file, mode: 'sideline', clips: [
      { aStart: 0, bStart: 4.5, len: 4, card: cards.sideline },
      { aStart: 9, bStart: 13.5, len: 0.6, card: cards.sideline },
    ] }, landscape, { onProgress: (p) => progress.push(p.fraction) });
    const info = await probe(landscape);
    assert.deepEqual([info.width, info.height, info.hasAudio], [1920, 1080, true]);
    assert.ok(Math.abs(info.duration - 4.6) < 0.25, `duration ${info.duration}`);
    assert.ok(isRed(await frame(landscape, 0.5, 800, 200)));
    assert.ok((await frame(landscape, 0.5, 800, 900)).every((v) => v > 220));
    assert.ok(isRed(await frame(landscape, 3.5, 800, 900)));
    assert.ok(isGreen(await frame(landscape, 4.3, 800, 200)));
    assert.ok((await frame(landscape, 4.3, 800, 900)).every((v) => v > 220));
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]));

    const portrait = path.join(temp, 'both.mp4');
    await exportClips({ file, mode: 'both', clips: [
      { aStart: 0, bStart: 4.5, len: 0.6, card: cards.both },
      { aStart: 9, bStart: 13.5, len: 0.6, card: cards.both },
    ] }, portrait);
    const portraitInfo = await probe(portrait);
    assert.deepEqual([portraitInfo.width, portraitInfo.height], [1080, 1920]);
    assert.ok(Math.abs(portraitInfo.duration - 1.2) < 0.25);
    assert.ok(isRed(await frame(portrait, 0.2, 500, 300)));
    assert.ok(isBlue(await frame(portrait, 0.2, 500, 900)));
    assert.ok(isGreen(await frame(portrait, 0.9, 500, 300)));
    assert.ok(isYellow(await frame(portrait, 0.9, 500, 900)));
    assert.ok((await frame(portrait, 0.9, 500, 1600)).every((v) => v > 220));

    const silentFile = path.join(temp, 'silent.mp4');
    await run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-i', file, '-c:v', 'copy', '-an', silentFile]);
    const endzone = path.join(temp, 'endzone.mp4');
    await exportClips({ file: silentFile, mode: 'endzone', clips: [
      { aStart: 0, bStart: 4.5, len: 0.6, card: cards.endzone },
    ] }, endzone);
    assert.ok(isBlue(await frame(endzone, 0.2, 800, 200)));
    assert.equal((await probe(endzone)).hasAudio, true);

    for (const mode of ['sideline', 'endzone', 'both']) {
      const cleanOutput = path.join(temp, `clean-${mode}.mp4`);
      await exportClips({ file: mode === 'endzone' ? silentFile : file, mode, clean: true, clips: [
        { aStart: 0, bStart: 4.5, len: 0.6 },
        { aStart: 9, bStart: 13.5, len: 0.6 },
      ] }, cleanOutput);
      const cleanInfo = await probe(cleanOutput);
      const { width, height } = dimensions(mode);
      assert.deepEqual([cleanInfo.width, cleanInfo.height, cleanInfo.hasAudio], [width, height, true]);
      assert.ok(Math.abs(cleanInfo.duration - 1.2) < 0.25);
      if (mode === 'both') {
        assert.ok(isRed(await frame(cleanOutput, 0.2, 500, 500)));
        assert.ok(isBlue(await frame(cleanOutput, 0.2, 500, 1100)));
        assert.ok(isGreen(await frame(cleanOutput, 0.9, 500, 500)));
        assert.ok(isYellow(await frame(cleanOutput, 0.9, 500, 1100)));
        assert.ok((await frame(cleanOutput, 0.2, 500, 1600)).every((v) => v < 20));
      } else {
        assert.ok((mode === 'sideline' ? isRed : isBlue)(await frame(cleanOutput, 0.2, 800, 900)));
        assert.ok((mode === 'sideline' ? isGreen : isYellow)(await frame(cleanOutput, 0.9, 800, 900)));
      }
    }

    const one = { file, mode: 'both', clips: [{ aStart: 0, bStart: 4.5, len: 4, card: cards.both }] };
    await assert.rejects(exportClips(one, file), /original film/);
    await assert.rejects(exportClips({ ...one, clips: [{ ...one.clips[0], bStart: 17 }] }, portrait), /past the end/);
    const existing = path.join(temp, 'existing.mp4');
    await fs.writeFile(existing, 'keep existing destination');
    const controller = new AbortController();
    await assert.rejects(exportClips(one, existing, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }), /Cancelled|abort/i);
    assert.equal(await fs.readFile(existing, 'utf8'), 'keep existing destination');
    await assert.rejects(exportClips({ ...one, clips: [{ ...one.clips[0], card: cardHeader('both') }] }, existing, {
      signal: AbortSignal.timeout(10000),
    }), /exited/);
    assert.equal(await fs.readFile(existing, 'utf8'), 'keep existing destination');
    assert.ok(!(await fs.readdir(temp)).some((name) => name.startsWith('.a22-export-')));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
