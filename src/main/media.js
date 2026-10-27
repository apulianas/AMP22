'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const { ffmpegPath, ffprobePath } = require('./ffpaths');
const scenes = require('../shared/scenes');
const orientation = require('../shared/orientation');
const { pairClips } = require('../shared/pairing');

const ANALYSIS_VERSION = 1;
const GRAB_W = 320;
const GRAB_H = 180;

function run(cmd, args, { onStdout, onStderr, signal, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const out = [];
    let errTail = '';
    const abort = () => child.kill('SIGKILL');
    if (signal) {
      if (signal.aborted) abort();
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
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abort);
      if (signal && signal.aborted) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      const stdout = Buffer.concat(out);
      if (code !== 0) return reject(new Error(`${cmd} exited with ${code}: ${errTail.trim().split('\n').slice(-5).join('\n')}`));
      resolve({ stdout: binary ? stdout : stdout.toString(), stderr: errTail });
    });
  });
}

async function probe(file) {
  const { stdout } = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
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
  const args = ['-hide_banner', '-nostats', '-v', 'info', '-progress', 'pipe:1', '-skip_frame', 'noref', '-i', file, '-an', '-sn', '-dn', '-vf', vf, '-f', 'null', '-'];
  return run(ffmpegPath(), args, {
    signal,
    onStdout: (d) => progLines.push(d.toString()),
    onStderr: (s) => errLines.push(s),
  }).then(() => {
    errLines.end();
    return scores;
  });
}

async function grabGray(file, t, { w = GRAB_W, h = GRAB_H, signal } = {}) {
  const args = ['-hide_banner', '-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-an', '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'];
  const { stdout } = await run(ffmpegPath(), args, { binary: true, signal });
  if (stdout.length < w * h) throw new Error(`Frame grab at ${t}s returned ${stdout.length} bytes`);
  return stdout.subarray(0, w * h);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const k = next++;
      results[k] = await fn(items[k], k);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Measures sideline vs end zone orientation for each clip (two sample frames). */
async function classifyClips(file, clips, { onProgress, signal, concurrency = 4 } = {}) {
  let done = 0;
  await mapLimit(clips, concurrency, async (clip) => {
    if (clip.duration >= 1) {
      const feats = [];
      for (const f of [0.35, 0.65]) {
        try {
          const g = await grabGray(file, clip.start + clip.duration * f, { signal });
          feats.push(orientation.features(g, GRAB_W, GRAB_H));
        } catch (e) {
          if (e.cancelled) throw e;
        }
      }
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
  const st = fs.statSync(file);
  onProgress({ phase: 'probe', fraction: 0, message: 'Reading film info' });
  const info = await probe(file);
  onProgress({ phase: 'scan', fraction: 0, message: 'Detecting camera cuts' });
  const candidates = await detectScenes(file, info.duration, {
    signal,
    onProgress: (f) => onProgress({ phase: 'scan', fraction: f, message: 'Detecting camera cuts' }),
  });
  const cuts = scenes.cutsFromScores(candidates, { threshold: cutThreshold, minGap: 0.4 });
  const clips = scenes.clipsFromCuts(cuts.map((c) => c.time), info.duration);
  onProgress({ phase: 'classify', fraction: 0, message: `Classifying ${clips.length} clips` });
  await classifyClips(file, clips, {
    signal,
    onProgress: (f) => onProgress({ phase: 'classify', fraction: f, message: `Classifying ${clips.length} clips` }),
  });
  const pairs = pairClips(clips);
  onProgress({ phase: 'done', fraction: 1, message: `Found ${pairs.length} plays` });
  return {
    version: ANALYSIS_VERSION,
    file,
    size: st.size,
    mtimeMs: st.mtimeMs,
    createdAt: new Date().toISOString(),
    cutThreshold,
    info,
    candidates: candidates.map((c) => ({ time: Math.round(c.time * 1e5) / 1e5, score: Math.round(c.score * 1e4) / 1e4 })),
    clips,
    pairs,
  };
}

module.exports = { ANALYSIS_VERSION, run, probe, detectScenes, grabGray, classifyClips, analyzeFilm, buildPairs, mapLimit };
