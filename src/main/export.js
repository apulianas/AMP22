'use strict';

const fs = require('fs/promises');
const path = require('path');
const { run, probe } = require('./media');
const { ffmpegPath } = require('./ffpaths');
const { MODES, dimensions } = require('../shared/export');

function validateRequest(request) {
  if (!request || typeof request.file !== 'string' || !MODES.includes(request.mode) ||
      !Array.isArray(request.clips) || !request.clips.length) {
    throw new Error('Choose a film, at least one linked play, and an export angle.');
  }
  if (request.clean !== undefined && typeof request.clean !== 'boolean') {
    throw new Error('Invalid clean export option.');
  }
  const { width, height } = dimensions(request.mode);
  for (const clip of request.clips) {
    if (!clip || ![clip.aStart, clip.bStart, clip.len].every(Number.isFinite) ||
        clip.aStart < 0 || clip.bStart < 0 || clip.len <= 0) {
      throw new Error('Invalid export clip timing.');
    }
    if (request.clean) continue;
    const png = clip.card;
    if (typeof png !== 'string' || png.length > 8 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png)) {
      throw new Error('Invalid play information image.');
    }
    const bytes = Buffer.from(png.slice('data:image/png;base64,'.length), 'base64');
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.toString('ascii', 12, 16) !== 'IHDR' ||
        bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) {
      throw new Error('Play information image has the wrong dimensions.');
    }
  }
  return request;
}

function segmentArgs(file, clip, mode, hasAudio, fps, clean = false) {
  const args = ['-hide_banner', '-v', 'error', '-xerror', '-nostats', '-progress', 'pipe:1', '-y'];
  const duration = clip.len.toFixed(6);
  const input = (start) => args.push('-ss', start.toFixed(6), '-t', duration, '-i', file);
  input(mode === 'endzone' ? clip.bStart : clip.aStart);
  if (mode === 'both') input(clip.bStart);
  const cardIndex = mode === 'both' ? 2 : 1;
  if (!clean) args.push('-framerate', String(fps), '-i', 'card.png');
  const audioIndex = hasAudio ? 0 : cardIndex + (clean ? 0 : 1);
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  const scale = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},setpts=PTS-STARTPTS`;
  const filters = mode === 'both'
    ? [
      `[0:v]${scale(1080, 608)}[a]`,
      `[1:v]${scale(1080, 608)}[b]`,
      `[a][b]vstack=inputs=2:shortest=1,pad=1080:1920:0:${clean ? '(oh-ih)/2' : '0'}:color=${clean ? 'black' : '0x0d1117'}[base]`,
    ]
    : [`[0:v]${scale(1920, 1080)}[base]`];
  filters.push(clean
    ? '[base]format=yuv420p[v]'
    : `[base][${cardIndex}:v]overlay=0:0:eof_action=repeat${mode === 'both' ? '' : ":enable='lt(t,3)'"},format=yuv420p[v]`);
  filters.push(`[${audioIndex}:a]aresample=48000,asetpts=PTS-STARTPTS,apad[audio]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[audio]',
    '-t', duration, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart');
  return args;
}

async function exportClips(request, destination, { signal, onProgress = () => {} } = {}) {
  const { file, mode, clips, clean = false } = validateRequest(request);
  const source = await fs.realpath(file);
  let target;
  try { target = await fs.realpath(destination); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (source === target || path.resolve(file) === path.resolve(destination)) {
    throw new Error('The export cannot replace the original film.');
  }
  const info = await probe(file);
  for (const clip of clips) {
    const starts = mode === 'both' ? [clip.aStart, clip.bStart] : [mode === 'endzone' ? clip.bStart : clip.aStart];
    if (starts.some((start) => start + clip.len > info.duration + 0.001)) {
      throw new Error('An export clip extends past the end of the film.');
    }
  }
  const temp = await fs.mkdtemp(path.join(path.dirname(destination), '.a22-export-'));
  const total = clips.reduce((sum, clip) => sum + clip.len, 0);
  const fps = Math.min(60, Math.max(1, info.fps));
  let done = 0;
  try {
    for (let i = 0; i < clips.length; i++) {
      signal?.throwIfAborted();
      const clip = clips[i];
      const card = path.join(temp, 'card.png');
      if (!clean) await fs.writeFile(card, Buffer.from(clip.card.split(',')[1], 'base64'));
      const args = segmentArgs(file, clip, mode, info.hasAudio, fps, clean);
      if (!clean) args[args.indexOf('card.png')] = card;
      args.push(path.join(temp, `clip-${i}.mp4`));
      let pending = '';
      await run(ffmpegPath(), args, {
        signal,
        onStdout: (data) => {
          pending += data.toString();
          const lines = pending.split('\n');
          pending = lines.pop();
          for (const line of lines) {
            const m = /^out_time_us=(\d+)/.exec(line);
            if (m) onProgress({ fraction: Math.min(0.98, (done + Math.min(clip.len, Number(m[1]) / 1e6)) / total * 0.98), message: `Exporting play ${i + 1} of ${clips.length}` });
          }
        },
      });
      done += clip.len;
    }
    signal?.throwIfAborted();
    onProgress({ fraction: 0.98, message: 'Joining clips' });
    const list = path.join(temp, 'clips.txt');
    await fs.writeFile(list, clips.map((_clip, i) => `file 'clip-${i}.mp4'`).join('\n'));
    const output = path.join(temp, 'export.mp4');
    await run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', list,
      '-c', 'copy', '-movflags', '+faststart', output], { signal });
    signal?.throwIfAborted();
    await fs.rename(output, destination);
    onProgress({ fraction: 1, message: 'Export complete' });
    return { path: destination };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

module.exports = { validateRequest, segmentArgs, exportClips };
