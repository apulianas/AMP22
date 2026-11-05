'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { clipRange, trimRange, exportSequence, selectedIndices, selectionRange, safeFilename, exportFilename, dimensions, overlayPosition, overlayBounds } = require('../src/shared/export');
const { validateRequest, segmentArgs, exportClips } = require('../src/main/export');
const { run, probe, previewFrame } = require('../src/main/media');
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

test('overlay presets and custom positions remain within every output frame', () => {
  assert.deepEqual(overlayPosition(), { preset: 'original' });
  for (const mode of ['sideline', 'endzone', 'both', 'sideline-first', 'endzone-first']) {
    const { width, height } = dimensions(mode);
    for (const preset of ['original', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const bounds = overlayBounds(mode, 500, 180, { preset });
      assert.equal(bounds.x, preset.endsWith('right') ? width - 548 : 48);
      assert.equal(bounds.y, preset.startsWith('top') ? 48 : height - 228);
    }
    for (const [x, y] of [[0, 0], [1, 1], [0.25, 0.75]]) {
      const position = { preset: 'custom', x, y };
      assert.deepEqual(overlayBounds(mode, 500, 180, position), {
        x: Math.round((width - 500) * x), y: Math.round((height - 180) * y), width: 500, height: 180,
      });
      assert.deepEqual(validateRequest(request({ overlayPosition: position })).overlayPosition, position);
    }
  }
  for (const value of [null, 'top-left', {}, { preset: 'custom', x: 2, y: 0 }, { preset: 'custom', x: 0, y: NaN }]) {
    assert.throws(() => validateRequest(request({ overlayPosition: value })), /overlay position/);
  }
});

test('movable portrait overlays center the footage while the original panel stays unchanged', () => {
  for (const position of [{ preset: 'original' }, { preset: 'top-right' }, { preset: 'custom', x: 0.3, y: 0.2 }]) {
    const args = segmentArgs('/film.mp4', clip, 'both', true, 30, false, 1.5, position);
    const filter = args[args.indexOf('-filter_complex') + 1];
    assert.ok(filter.includes(position.preset === 'original' ? 'pad=1080:1920:0:0:color=0x0d1117' : 'pad=1080:1920:0:(oh-ih)/2:color=black'));
    assert.ok(filter.includes("enable='lt(t,1.5)'"));
  }
});

test('decimal trim advances both synced angles equally and cannot remove a whole clip', () => {
  const range = { aStart: 10.008, bStart: 20.108, len: 4 };
  assert.deepEqual(trimRange(range, 1.25), { aStart: 11.258, bStart: 21.358, len: 2.75 });
  assert.deepEqual(trimRange(range, 0), range);
  assert.equal(range.len, 4);
  for (const seconds of [-1, 4, 5, NaN, Infinity, '', null]) {
    assert.throws(() => trimRange(range, seconds), /Trim/);
  }
});

test('grouped angle exports use game order within each block, including split sources', () => {
  const clips = [{ file: 'offense', play: 1 }, { file: 'defense', play: 2 }];
  for (const [mode, first, second] of [['sideline-first', 'sideline', 'endzone'], ['endzone-first', 'endzone', 'sideline']]) {
    const sequence = exportSequence(clips, mode);
    assert.deepEqual(sequence.map((s) => s.mode), [first, first, second, second]);
    assert.deepEqual(sequence.map((s) => s.clip.play), [1, 2, 1, 2]);
    assert.deepEqual(sequence.map((s) => s.clip.file), ['offense', 'defense', 'offense', 'defense']);
    assert.deepEqual(dimensions(mode), { width: 1920, height: 1080 });
    assert.equal(validateRequest(request({ mode, clips: [{ ...clip, card: cardHeader(mode) }] })).mode, mode);
  }
});

test('overlay duration applies to all layouts and rejects invalid IPC values', () => {
  for (const mode of ['sideline', 'endzone', 'both']) {
    for (const seconds of [0, 0.75, 12]) {
      const args = segmentArgs('/film.mp4', clip, mode, true, 30, false, seconds);
      assert.ok(args[args.indexOf('-filter_complex') + 1].includes(`enable='lt(t,${seconds})'`));
    }
  }
  for (const overlaySeconds of [-1, NaN, Infinity, '3', null]) {
    assert.throws(() => validateRequest(request({ overlaySeconds })), /overlay duration/);
  }
});

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

test('single-play names use team, possession, game play number, down and distance', () => {
  const first = { qtr: 2, time: '08:34', down: 2, ydstogo: 7 };
  const context = { team: 'BAL', playNumber: 12, role: 'offense' };
  assert.equal(exportFilename([first], context), 'BAL-O-12-2-7.mp4');
  assert.equal(exportFilename([first], { ...context, role: 'defense' }), 'BAL-D-12-2-7.mp4');
  assert.equal(exportFilename([{ down: null, ydstogo: null }], { ...context, role: 'special' }), 'BAL-ST-12-NA-NA.mp4');
  assert.equal(exportFilename([{ down: 1, ydstogo: 0 }], context), 'BAL-O-12-1-0.mp4');
  assert.equal(exportFilename([first], { ...context, role: null }), 'BAL-NA-12-2-7.mp4');
  for (const patch of [{ team: '' }, { playNumber: 0 }, { playNumber: undefined }]) {
    assert.throws(() => exportFilename([first], { ...context, ...patch }), /team and game play number/);
  }
  assert.throws(() => exportFilename([first]), /team and game play number/);
});

test('multi-play names retain clock ranges and all filenames remain safe', () => {
  const first = { qtr: 2, time: '08:34' };
  const last = { qtr: 3, time: '04:12' };
  assert.equal(exportFilename([first, last]), 'Q2-08m34s-to-Q3-04m12s.mp4');
  assert.equal(exportFilename([{ qtr: 5, time: '8:12' }, { qtr: 6, time: '4:00' }]), 'OT-8m12s-to-OT2-4m00s.mp4');
  assert.equal(exportFilename([]), 'clip.mp4');
  assert.equal(safeFilename('../clip\\bad:name?*.mp4'), 'clip-bad-name.mp4');
  assert.equal(safeFilename('CON.mp4'), 'AMP22-CON.mp4');
  assert.equal(safeFilename('...'), 'AMP22-clip.mp4');
  assert.equal(exportFilename([first], { team: '../BAL', role: 'offense', playNumber: 12 }), 'BAL-O-12-NA-NA.mp4');
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
  assert.equal(validateRequest(request({ clips: [{ ...clip, file: '/defense.mp4' }] })).clips[0].file, '/defense.mp4');
  for (const file of [null, 7, '', ' ']) {
    assert.throws(() => validateRequest(request({ clips: [{ ...clip, file }] })), /film source/);
  }
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
    const preview = await previewFrame(file, 4.5);
    assert.ok(preview.startsWith('data:image/jpeg;base64,'));
    const previewPath = path.join(temp, 'preview.jpg');
    await fs.writeFile(previewPath, Buffer.from(preview.split(',')[1], 'base64'));
    assert.ok(isBlue(await frame(previewPath, 0, 100, 100)));
    await assert.rejects(previewFrame(file, 999), /No preview/);
    for (const mode of ['sideline-first', 'endzone-first']) {
      const output = path.join(temp, `${mode}.mp4`);
      await exportClips({ file, mode, clean: true, clips: [
        trimRange({ aStart: 0, bStart: 4.5, len: 1 }, 0.25),
        trimRange({ aStart: 9, bStart: 13.5, len: 1 }, 0.5),
      ] }, output);
      const expected = mode === 'sideline-first' ? [isRed, isGreen, isBlue, isYellow] : [isBlue, isYellow, isRed, isGreen];
      for (const [i, t] of [0.2, 0.9, 1.5, 2.2].entries()) {
        assert.ok(expected[i](await frame(output, t, 800, 200)), `${mode} segment ${i}`);
      }
      assert.ok(Math.abs((await probe(output)).duration - 2.5) < 0.25);
    }
    for (const mode of ['sideline', 'both']) {
      const output = path.join(temp, `timed-${mode}.mp4`);
      await exportClips({ file, mode, overlaySeconds: 0.5, clips: [
        { aStart: 0, bStart: 4.5, len: 1, card: cards[mode] },
      ] }, output);
      const [x, y] = mode === 'both' ? [500, 1600] : [800, 900];
      assert.ok((await frame(output, 0.2, x, y)).every((v) => v > 220));
      const after = await frame(output, 0.8, x, y);
      assert.ok(mode === 'both' ? after.every((v) => v < 40) : isRed(after));
    }
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

    const defenseFile = path.join(temp, 'defense.mp4');
    await run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-ss', '9', '-i', silentFile,
      '-t', '9', '-c', 'copy', defenseFile]);
    const mixedOutput = path.join(temp, 'split.mp4');
    const mixed = { file, mode: 'both', clean: true, clips: [
      { file, aStart: 0, bStart: 4.5, len: 0.6 },
      { file: defenseFile, aStart: 0, bStart: 4.5, len: 0.6 },
      { file, aStart: 0, bStart: 4.5, len: 0.6 },
    ] };
    await exportClips(mixed, mixedOutput);
    assert.ok(isRed(await frame(mixedOutput, 0.2, 500, 500)));
    assert.ok(isBlue(await frame(mixedOutput, 0.2, 500, 1100)));
    assert.ok(isGreen(await frame(mixedOutput, 0.9, 500, 500)));
    assert.ok(isYellow(await frame(mixedOutput, 0.9, 500, 1100)));
    assert.ok(isRed(await frame(mixedOutput, 1.5, 500, 500)));
    assert.equal((await probe(mixedOutput)).hasAudio, true);
    await assert.rejects(exportClips(mixed, defenseFile), /original film/);
    await assert.rejects(exportClips({ ...mixed, clips: [
      { ...mixed.clips[1], bStart: 8.8 },
    ] }, mixedOutput), /past the end/);

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
