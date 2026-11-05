'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const { availableParallelism } = require('os');
const { ffmpegPath, ffprobePath } = require('./ffpaths');
const scenes = require('../shared/scenes');
const orientation = require('../shared/orientation');
const { pairClips } = require('../shared/pairing');

const ANALYSIS_VERSION = 1;
const GRAB_W = 320;
const GRAB_H = 180;
const ANALYSIS_CONCURRENCY = Math.max(1, Math.min(4, availableParallelism() - 1));
const ANALYSIS_THREADS = Math.max(1, Math.min(2, Math.floor(availableParallelism() / ANALYSIS_CONCURRENCY)));
const analysisQueue = createLimiter(ANALYSIS_CONCURRENCY);

function cancelledError() {
  return Object.assign(new Error('Cancelled'), { cancelled: true });
}

function createLimiter(limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit');
  let active = 0;
  const queue = [];
  function drain() {
    while (active < limit && queue.length) {
      const job = queue.shift();
      job.signal?.removeEventListener('abort', job.abort);
      if (job.signal?.aborted) {
        job.reject(cancelledError());
        continue;
      }
      active++;
      Promise.resolve().then(() => {
        if (job.signal?.aborted) throw cancelledError();
        return job.fn();
      }).then(job.resolve, job.reject).finally(() => {
        active--;
        drain();
      });
    }
  }
  return (fn, { signal } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelledError());
    const job = { fn, signal, resolve, reject, abort: null };
    job.abort = () => {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      reject(cancelledError());
    };
    signal?.addEventListener('abort', job.abort, { once: true });
    queue.push(job);
    drain();
  });
}

function runAnalysis(cmd, args, options = {}) {
  return analysisQueue(() => run(cmd, args, options), options);
}

function run(cmd, args, { onStdout, onStderr, signal, binary = false } = {}) {
  if (signal?.aborted) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const out = [];
    let errTail = '';
    const abort = () => child.kill('SIGKILL');
    if (signal) {
      signal.addEventListener('abort', abort, { once: true });
    }
    child.stdout.on('data', (d) => {
      if (onStdout) onStdout(d);
      else out.push(d);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      if (onStderr) onStderr(s);
      errTail = (errTail + s).slice(-8000);
    });
    child.on('error', (error) => {
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abort);
      if (signal && signal.aborted) return reject(cancelledError());
      const stdout = Buffer.concat(out);
      if (code !== 0) return reject(new Error(`${cmd} exited with ${code}: ${errTail.trim().split('\n').slice(-5).join('\n')}`));
      resolve({ stdout: binary ? stdout : stdout.toString(), stderr: errTail });
    });
  });
}

async function probe(file, { signal } = {}) {
  const { stdout } = await runAnalysis(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { signal });
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream found');
  const rf = scenes.parseRate(v.r_frame_rate);
  const fps = (rf && rf <= 120 ? rf : null) || scenes.parseRate(v.avg_frame_rate) || 30;
  return {
    duration: Number(j.format.duration) || Number(v.duration) || 0,
    startTime: Number(j.format.start_time) || 0,
    fps,
    fpsRational: v.r_frame_rate,
    width: v.width,
    height: v.height,
    codec: v.codec_name,
    hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

/** Fast scene-cut scan. Returns [{time, score}] for frames with score > candidateThreshold. */
function detectScenes(file, duration, { candidateThreshold = 0.06, onProgress, signal } = {}) {
  const scores = [];
  const parse = scenes.createMetadataParser((s) => scores.push(s));
  const errLines = scenes.createLineSplitter(parse);
  const progLines = scenes.createLineSplitter((line) => {
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
    if (m && onProgress && duration > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
  });
  const vf = `scale=64:36,select='gt(scene\\,${candidateThreshold})',metadata=print:key=lavfi.scene_score`;
  const args = ['-hide_banner', '-nostats', '-v', 'info', '-progress', 'pipe:1', '-threads', String(ANALYSIS_THREADS),
    '-skip_frame', 'noref', '-i', file, '-an', '-sn', '-dn', '-filter_threads', '1', '-vf', vf, '-f', 'null', '-'];
  return runAnalysis(ffmpegPath(), args, {
    signal,
    onStdout: (d) => progLines.push(d.toString()),
    onStderr: (s) => errLines.push(s),
  }).then(() => {
    errLines.end();
    return scores;
  });
}

async function grabGray(file, t, { w = GRAB_W, h = GRAB_H, signal } = {}) {
  const args = ['-hide_banner', '-v', 'error', '-threads', '1', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-an',
    '-filter_threads', '1', '-vf', `scale=${w}:${h},format=gray`, '-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'];
  const { stdout } = await runAnalysis(ffmpegPath(), args, { binary: true, signal });
  if (stdout.length < w * h) throw new Error(`Frame grab at ${t}s returned ${stdout.length} bytes`);
  return stdout.subarray(0, w * h);
}

/** Independent input seeks preserve the original sample timestamps with one process per clip. */
async function grabGraySamples(file, times, { signal } = {}) {
  const args = ['-hide_banner', '-v', 'error', '-filter_complex_threads', '1'];
  for (const t of times) args.push('-threads', '1', '-ss', t.toFixed(3), '-i', file);
  const filters = times.map((_, i) =>
    `[${i}:v:0]trim=end_frame=1,scale=${GRAB_W}:${GRAB_H},format=gray,setpts=PTS-STARTPTS[s${i}]`);
  filters.push(`${times.map((_, i) => `[s${i}]`).join('')}concat=n=${times.length}:v=1:a=0[out]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', String(times.length),
    '-fps_mode', 'passthrough', '-an', '-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1');
  const { stdout } = await runAnalysis(ffmpegPath(), args, { binary: true, signal });
  const bytes = GRAB_W * GRAB_H;
  if (stdout.length !== bytes * times.length) throw new Error(`Clip samples returned ${stdout.length} bytes; expected ${bytes * times.length}`);
  return times.map((_, i) => stdout.subarray(i * bytes, (i + 1) * bytes));
}

async function previewFrame(file, time) {
  if (typeof file !== 'string' || !Number.isFinite(time) || time < 0) throw new Error('Invalid preview timing or film.');
  const { stdout } = await run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-ss', time.toFixed(6),
    '-i', file, '-frames:v', '1', '-an', '-vf', 'scale=480:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
  { binary: true, signal: AbortSignal.timeout(15000) });
  if (!stdout.length) throw new Error('No preview frame at the trimmed start. Reduce the trim.');
  return `data:image/jpeg;base64,${stdout.toString('base64')}`;
}

async function mapLimit(items, limit, fn) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit');
  const results = new Array(items.length);
  let next = 0;
  let failure = null;
  async function worker() {
    while (!failure && next < items.length) {
      const k = next++;
      try {
        results[k] = await fn(items[k], k);
      } catch (error) {
        failure ||= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure;
  return results;
}

/** Measures sideline vs end zone orientation for each clip (two sample frames). */
async function classifyClips(file, clips, { onProgress, onWarning = () => {}, signal, concurrency = ANALYSIS_CONCURRENCY } = {}) {
  let done = 0;
  await mapLimit(clips, concurrency, async (clip) => {
    if (signal?.aborted) throw cancelledError();
    if (clip.duration >= 1) {
      const feats = [];
      const times = [0.35, 0.65].map((f) => clip.start + clip.duration * f);
      let frames;
      try {
        frames = await grabGraySamples(file, times, { signal });
      } catch (error) {
        if (signal?.aborted || error.cancelled) throw error;
        // Keep usable samples from damaged or truncated clips.
        onWarning({ clipIndex: clip.index, message: `Batch sampling failed; retrying individually: ${error.message}` });
        frames = [];
        for (const time of times) {
          try {
            frames.push(await grabGray(file, time, { signal }));
          } catch (e) {
            if (signal?.aborted || e.cancelled) throw e;
            onWarning({ clipIndex: clip.index, message: `Frame at ${time.toFixed(3)}s unavailable: ${e.message}` });
          }
        }
      }
      for (const frame of frames) feats.push(orientation.features(frame, GRAB_W, GRAB_H));
      clip.orient = feats.length ? Math.round((feats.reduce((a, b) => a + b.score, 0) / feats.length) * 1000) / 1000 : null;
    } else {
      clip.orient = null;
    }
    done++;
    if (onProgress) onProgress(done / clips.length);
  });
  return clips;
}

function buildPairs(candidates, clipsWithOrient, duration, cutThreshold) {
  const cuts = scenes.cutsFromScores(candidates, { threshold: cutThreshold, minGap: 0.4 });
  const clips = clipsWithOrient || scenes.clipsFromCuts(cuts.map((c) => c.time), duration);
  return { cuts, clips, pairs: pairClips(clips) };
}

/**
 * Full analysis: probe, scene scan, per-clip orientation, pairing.
 * onProgress({phase, fraction, message})
 */
async function analyzeFilm(file, { onProgress = () => {}, signal, cutThreshold = 0.1 } = {}) {
  const started = performance.now();
  const timings = {};
  const warnings = [];
  const st = fs.statSync(file);
  onProgress({ phase: 'probe', fraction: 0, message: 'Reading film info' });
  const info = await probe(file, { signal });
  timings.probeMs = performance.now() - started;
  let phaseStarted = performance.now();
  onProgress({ phase: 'scan', fraction: 0, message: 'Detecting camera cuts' });
  const candidates = await detectScenes(file, info.duration, {
    signal,
    onProgress: (f) => onProgress({ phase: 'scan', fraction: f, message: 'Detecting camera cuts' }),
  });
  timings.scanMs = performance.now() - phaseStarted;
  phaseStarted = performance.now();
  const cuts = scenes.cutsFromScores(candidates, { threshold: cutThreshold, minGap: 0.4 });
  const clips = scenes.clipsFromCuts(cuts.map((c) => c.time), info.duration);
  onProgress({ phase: 'classify', fraction: 0, message: `Classifying ${clips.length} clips` });
  await classifyClips(file, clips, {
    signal,
    onWarning: (warning) => warnings.push(warning),
    onProgress: (f) => onProgress({ phase: 'classify', fraction: f, message: `Classifying ${clips.length} clips` }),
  });
  timings.classifyMs = performance.now() - phaseStarted;
  phaseStarted = performance.now();
  const pairs = pairClips(clips);
  timings.pairMs = performance.now() - phaseStarted;
  timings.totalMs = performance.now() - started;
  onProgress({ phase: 'done', fraction: 1, message: `Found ${pairs.length} plays` });
  return {
    version: ANALYSIS_VERSION,
    file,
    size: st.size,
    mtimeMs: st.mtimeMs,
    createdAt: new Date().toISOString(),
    cutThreshold,
    timings,
    warnings,
    info,
    candidates: candidates.map((c) => ({ time: Math.round(c.time * 1e5) / 1e5, score: Math.round(c.score * 1e4) / 1e4 })),
    clips,
    pairs,
  };
}

module.exports = { ANALYSIS_VERSION, ANALYSIS_CONCURRENCY, run, probe, previewFrame, detectScenes, grabGray,
  grabGraySamples, classifyClips, analyzeFilm, buildPairs, mapLimit, createLimiter };
