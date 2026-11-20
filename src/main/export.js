'use strict';

const fs = require('fs/promises');
const path = require('path');
const { run, probe, frameStart } = require('./media');
const { ffmpegPath } = require('./ffpaths');
const { MODES, dimensions, exportSequence, overlayPosition } = require('../shared/export');
const highlights = require('./highlight-export');
const rewind = require('../shared/rewind');

function validateRequest(request) {
  if (!request || typeof request.file !== 'string' || !MODES.includes(request.mode) ||
      !Array.isArray(request.clips) || !request.clips.length) {
    throw new Error('Choose a film, at least one linked play, and an export angle.');
  }
  if (request.clean !== undefined && typeof request.clean !== 'boolean') {
    throw new Error('Invalid clean export option.');
  }
  if (request.overlaySeconds !== undefined && (!Number.isFinite(request.overlaySeconds) || request.overlaySeconds < 0)) {
    throw new Error('Invalid overlay duration.');
  }
  overlayPosition(request.overlayPosition);
  const { width, height } = dimensions(request.mode);
  for (const clip of request.clips) {
    if (clip?.file !== undefined && (typeof clip.file !== 'string' || !clip.file.trim())) {
      throw new Error('Invalid export film source.');
    }
    if (!clip || ![clip.aStart, clip.bStart, clip.len].every(Number.isFinite) ||
        clip.aStart < 0 || clip.bStart < 0 || clip.len <= 0) {
      throw new Error('Invalid export clip timing.');
    }
    rewind.validate(clip.rewinds, clip.len);
    if (request.clean) continue;
    highlights.validateHighlights(clip.highlights);
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

// An intermediate segment has highlights but no card and is stored near-losslessly for the rewind pass.
function segmentArgs(file, clip, mode, hasAudio, fps, clean = false, overlaySeconds = mode === 'both' ? null : 3, position, markers = [], intermediate = false) {
  const centered = clean || overlayPosition(position).preset !== 'original';
  const withCard = !clean && !intermediate;
  const args = ['-hide_banner', '-v', 'error', '-xerror', '-nostats', '-progress', 'pipe:1', '-y'];
  const duration = clip.len.toFixed(6);
  const input = (start, len = clip.len) => args.push('-ss', start.toFixed(6), '-t', len.toFixed(6), '-i', file);
  if (mode === 'endzone') input(clip.bStart, clip.bLen);
  else input(clip.aStart, clip.aLen);
  if (mode === 'both') input(clip.bStart, clip.bLen);
  const cardIndex = mode === 'both' ? 2 : 1;
  const markerStart = cardIndex + (withCard ? 1 : 0);
  if (withCard) args.push('-framerate', String(fps), '-i', 'card.png');
  if (!clean) markers.forEach((_marker, index) => args.push('-loop', '1', '-framerate', String(fps), '-i', `highlight-${index}.png`));
  const audioIndex = hasAudio ? 0 : markerStart + (clean ? 0 : markers.length);
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  const scale = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},setpts=PTS-STARTPTS`;
  const filters = mode === 'both'
    ? [
      `[0:v]${scale(1080, 608)}[a]`,
      `[1:v]${scale(1080, 608)}[b]`,
      `[a][b]vstack=inputs=2:shortest=1,pad=1080:1920:0:${centered ? '(oh-ih)/2' : '0'}:color=${centered ? 'black' : '0x0d1117'}[base]`,
    ]
    : [`[0:v]${scale(1920, 1080)}[base]`];
  let base = 'base';
  if (!clean) markers.forEach((marker, index) => {
    const expression = highlights.expressions(marker);
    const output = `highlighted${index}`;
    filters.push(`[${base}][${markerStart + index}:v]overlay=x='${expression.x}':y='${expression.y}':enable='${expression.enable}':eof_action=repeat[${output}]`);
    base = output;
  });
  filters.push(!withCard
    ? `[${base}]format=yuv420p[v]`
    : `[${base}][${cardIndex}:v]overlay=0:0:eof_action=repeat${overlaySeconds === null ? '' : `:enable='lt(t,${overlaySeconds})'`},format=yuv420p[v]`);
  filters.push(`[${audioIndex}:a]aresample=48000,asetpts=PTS-STARTPTS,apad[audio]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[audio]', '-t', duration);
  args.push(...(intermediate
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2']
    : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart']));
  return args;
}

/**
 * Plays an intermediate segment forward and backward as `rewind.plan` describes. Every piece is read with its
 * own frame-exact seek, so only the reversed span is held in memory, and each is put on the same frame grid and
 * timebase before `concat`, which otherwise mis-times pieces that came through different filters.
 */
function rewindArgs(file, fps, segments, clean = false, overlaySeconds = 3) {
  const args = ['-hide_banner', '-v', 'error', '-xerror', '-nostats', '-progress', 'pipe:1', '-y'];
  for (const segment of segments) {
    args.push('-ss', Math.max(0, (segment.from - 0.5) / fps).toFixed(6));
    if (segment.to !== null) args.push('-t', ((segment.to - segment.from) / fps).toFixed(6));
    args.push('-i', file);
  }
  if (!clean) args.push('-framerate', String(fps), '-i', 'card.png');
  const grid = `fps=${fps},setpts=N/(${fps}*TB),settb=AVTB`;
  const audio = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const filters = [];
  segments.forEach((segment, i) => {
    if (segment.kind === 'forward') {
      filters.push(`[${i}:v]setpts=PTS-STARTPTS,${grid}[v${i}]`, `[${i}:a]asetpts=PTS-STARTPTS,${audio}[a${i}]`);
      return;
    }
    const speed = Number(segment.speed.toFixed(4));
    const retime = `setpts=(PTS-STARTPTS)/${speed}`;
    // Reverse first when slowing down so the buffer holds the source frames, not the stretched ones.
    const video = speed < 1 ? `reverse,${retime},${grid}` : `${retime},fps=${fps},reverse,setpts=N/(${fps}*TB),settb=AVTB`;
    filters.push(`[${i}:v]${video}[v${i}]`, `[${i}:a]areverse,atempo=${speed},asetpts=PTS-STARTPTS,${audio}[a${i}]`);
  });
  filters.push(`${segments.map((_segment, i) => `[v${i}][a${i}]`).join('')}concat=n=${segments.length}:v=1:a=1[joined][audio]`);
  filters.push(clean
    ? '[joined]fps=' + fps + ',format=yuv420p[v]'
    : `[joined]fps=${fps}[timed];[timed][${segments.length}:v]overlay=0:0:eof_action=repeat${overlaySeconds === null ? '' : `:enable='lt(t,${overlaySeconds})'`},format=yuv420p[v]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[audio]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart');
  return args;
}

const SEEK_MARGIN = 0.0005;

/**
 * Moves each seek back to the start of the frame the preview shows at the trim start, keeping the end fixed.
 * `shown` holds that frame's time for aStart and bStart (null when unknown). The output keeps whole frames
 * because ffmpeg's output duration only retains frames that end within it.
 */
function frameAlignedClip(clip, angle, shown = {}, fps = 30) {
  const aligned = { ...clip };
  const keys = angle === 'both' ? ['aStart', 'bStart'] : [angle === 'endzone' ? 'bStart' : 'aStart'];
  const outputs = keys.map((key) => {
    const frame = shown[key];
    const shift = Number.isFinite(frame) && frame <= clip[key] ? clip[key] - frame + SEEK_MARGIN : 0;
    const usable = shift > 0 && shift < 1 && clip[key] - shift >= 0;
    aligned[key] = usable ? clip[key] - shift : clip[key];
    aligned[key === 'aStart' ? 'aLen' : 'bLen'] = clip.len + (usable ? shift : 0);
    return usable ? Math.ceil((clip.len + shift - SEEK_MARGIN) * fps - 0.01) / fps + SEEK_MARGIN : clip.len;
  });
  aligned.len = Math.min(...outputs);
  return aligned;
}

async function exportClips(request, destination, { signal, onProgress = () => {} } = {}) {
  const { file, mode, clips, clean = false } = validateRequest(request);
  const segments = exportSequence(clips, mode);
  let target;
  try { target = await fs.realpath(destination); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const sources = new Map();
  for (const sourceFile of new Set(clips.map((clip) => clip.file || file))) {
    const source = await fs.realpath(sourceFile);
    if (source === target || path.resolve(sourceFile) === path.resolve(destination)) {
      throw new Error('The export cannot replace the original film.');
    }
    sources.set(sourceFile, await probe(sourceFile));
  }
  for (const clip of clips) {
    const info = sources.get(clip.file || file);
    const starts = ['both', 'sideline-first', 'endzone-first'].includes(mode) ? [clip.aStart, clip.bStart] : [mode === 'endzone' ? clip.bStart : clip.aStart];
    if (starts.some((start) => start + clip.len > info.duration + 0.001)) {
      throw new Error('An export clip extends past the end of the film.');
    }
  }
  const temp = await fs.mkdtemp(path.join(path.dirname(destination), '.a22-export-'));
  const fps = Math.min(60, Math.max(1, sources.values().next().value.fps));
  const framesOf = clip => Math.max(1, Math.floor(clip.len * fps + 1e-6));
  const reworked = clip => rewind.hasRewind(clip.rewinds, fps, framesOf(clip));
  const weights = segments.map(({ clip }) => clip.len + (reworked(clip) ? rewind.outputSeconds(clip.rewinds, fps, framesOf(clip)) : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let done = 0;
  const encoding = (i, offset, length) => {
    let pending = '';
    return (data) => {
      pending += data.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m) onProgress({ fraction: Math.min(0.98, (done + offset + Math.min(length, Number(m[1]) / 1e6)) / total * 0.98), message: `Exporting clip ${i + 1} of ${segments.length}` });
      }
    };
  };
  try {
    for (let i = 0; i < segments.length; i++) {
      signal?.throwIfAborted();
      const { clip: requested, mode: angle } = segments[i];
      const sourceFile = requested.file || file;
      const info = sources.get(sourceFile);
      const shown = {};
      for (const key of angle === 'both' ? ['aStart', 'bStart'] : [angle === 'endzone' ? 'bStart' : 'aStart']) {
        shown[key] = await frameStart(sourceFile, requested[key], { startTime: info.startTime, signal }).catch((error) => {
          if (signal?.aborted) throw error;
          return null;
        });
      }
      const clip = frameAlignedClip(requested, angle, shown, fps);
      const rewinding = reworked(requested);
      const card = path.join(temp, 'card.png');
      if (!clean) await fs.writeFile(card, Buffer.from(clip.card.split(',')[1], 'base64'));
      const markers = clean ? [] : highlights.descriptors(clip, angle, sources.get(sourceFile), overlayPosition(request.overlayPosition).preset !== 'original');
      const args = segmentArgs(sourceFile, clip, angle, sources.get(sourceFile).hasAudio, fps, clean, request.overlaySeconds, request.overlayPosition, markers, rewinding);
      if (!clean && !rewinding) args[args.indexOf('card.png')] = card;
      for (const [index, marker] of markers.entries()) {
        const image = path.join(temp, `highlight-${index}.png`);
        await fs.writeFile(image, Buffer.from(marker.track.graphic.dataUrl.split(',')[1], 'base64'));
        args[args.indexOf(`highlight-${index}.png`)] = image;
      }
      if (markers.length) {
        const filterIndex = args.indexOf('-filter_complex');
        const script = path.join(temp, 'highlight-filter.txt');
        await fs.writeFile(script, args[filterIndex + 1]);
        args.splice(filterIndex, 2, '-filter_complex_script', script);
      }
      const base = path.join(temp, rewinding ? `base-${i}.mkv` : `clip-${i}.mp4`);
      args.push(base);
      await run(ffmpegPath(), args, { signal, onStdout: encoding(i, 0, requested.len) });
      if (rewinding) {
        signal?.throwIfAborted();
        const frames = Math.min(framesOf(clip), Math.max(1, Math.round((await probe(base)).duration * fps)));
        const sequence = rewind.plan(requested.rewinds, fps, frames);
        const length = rewind.outputSeconds(requested.rewinds, fps, frames);
        const pass = rewindArgs(base, fps, sequence, clean, request.overlaySeconds ?? (angle === 'both' ? null : 3));
        if (!clean) pass[pass.indexOf('card.png')] = card;
        const filterIndex = pass.indexOf('-filter_complex');
        const script = path.join(temp, `rewind-filter-${i}.txt`);
        await fs.writeFile(script, pass[filterIndex + 1]);
        pass.splice(filterIndex, 2, '-filter_complex_script', script);
        pass.push(path.join(temp, `clip-${i}.mp4`));
        await run(ffmpegPath(), pass, { signal, onStdout: encoding(i, requested.len, length) });
        await fs.rm(base, { force: true });
      }
      done += weights[i];
    }
    signal?.throwIfAborted();
    onProgress({ fraction: 0.98, message: 'Joining clips' });
    const list = path.join(temp, 'clips.txt');
    await fs.writeFile(list, segments.map((_segment, i) => `file 'clip-${i}.mp4'`).join('\n'));
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

module.exports = { validateRequest, segmentArgs, rewindArgs, frameAlignedClip, exportClips };
