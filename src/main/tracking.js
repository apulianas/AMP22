'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const tracking = require('../shared/tracking');
const motion = require('./player-motion');

function validateAnalysis(request) {
  if (!request || typeof request.file !== 'string' || !request.file ||
      ![request.start, request.len].every(Number.isFinite) || request.start < 0 ||
      request.len <= 0 || request.len > tracking.MAX_SECONDS ||
      !Array.isArray(request.seeds) || request.seeds.length < 1 || request.seeds.length > 12 ||
      request.seeds.some(p => !p || ![p.x, p.y].every(Number.isFinite) || p.x < 0.02 || p.x > 0.98 || p.y < 0.04 || p.y > 0.96)) {
    throw new Error('Choose a player inside the frame and at most 60 seconds of one clip.');
  }
  return request;
}

function analyze(request, { signal, onProgress = () => {} } = {}) {
  validateAnalysis(request);
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(__filename, { workerData: request });
    let settled = false;
    const cancel = () => worker.postMessage('cancel');
    signal?.addEventListener('abort', cancel, { once: true });
    worker.on('message', message => {
      if (message.progress !== undefined) onProgress(message.progress);
      else {
        settled = true;
        if (message.error) reject(new Error(message.error));
        else resolve(message.result);
      }
    });
    worker.on('error', error => { settled = true; reject(error); });
    worker.on('exit', code => {
      signal?.removeEventListener('abort', cancel);
      if (!settled) reject(new Error(`Player tracking stopped unexpectedly (${code}).`));
    });
  });
}

async function analyzeFrames(request, { signal, onProgress = () => {} } = {}) {
  const { run, probe } = require('./media');
  const { ffmpegPath } = require('./ffpaths');
  const info = await probe(request.file);
  signal?.throwIfAborted();
  if (request.start + request.len > info.duration + 0.001) throw new Error('Tracking extends past the film.');
  const width = motion.WIDTH, height = motion.HEIGHT, frameSize = width * height * 3;
  const fits = Math.min(width / info.width, height / info.height);
  const content = { w: Math.round(info.width * fits), h: Math.round(info.height * fits) };
  const offset = { x: (width - content.w) / 2, y: (height - content.h) / 2 };
  const seeds = request.seeds.map(p => ({ x: offset.x + p.x * content.w, y: offset.y + p.y * content.h }));
  let trackers = null;
  let probes = seeds.map(p => ({ x: p.x / 2, y: p.y / 2, missed: 0 }));
  const tracks = seeds.map(() => []);
  const samples = [];
  let previous = null, sampleFrame = null, pending = Buffer.alloc(0), frame = 0;
  const warning = new Set();
  await run(ffmpegPath(), ['-hide_banner', '-v', 'error', '-ss', request.start.toFixed(6), '-i', request.file,
    '-t', request.len.toFixed(6), '-an', '-sn', '-dn', '-vf',
    `fps=${motion.RATE},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    signal,
    onStdout(data) {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= frameSize) {
        const rgb = pending.subarray(0, frameSize);
        const current = motion.pyramid(rgb, width, height);
        pending = pending.subarray(frameSize);
        const t = request.start + frame / motion.RATE;
        if (previous) {
          trackers = trackers.map((tracker, index) => {
            if (!tracker) return null;
            const result = motion.advanceTracker(tracker, rgb, previous, current);
            if (!result || result.x < offset.x + 8 || result.x >= offset.x + content.w - 8 ||
                result.y < offset.y + 8 || result.y >= offset.y + content.h - 8) {
              warning.add(`Target ${index + 1} lost at ${(t - request.start).toFixed(2)}s; review and correct its position.`);
              return null;
            }
            return tracker;
          });
        } else trackers = seeds.map(seed => motion.createTracker(rgb, current, seed));
        if (frame % (motion.RATE / tracking.RATE) === 0) {
          const speeds = seeds.map(() => null);
          const gray = current[1];
          const players = trackers.map(tracker => tracker && ({ x: tracker.point.x / 2, y: tracker.point.y / 2 }));
          const camera = request.seeds.length >= 4 && sampleFrame &&
            tracking.cameraShift(sampleFrame.data, gray.data, gray.width, gray.height, players.filter(Boolean));
          probes = probes.map((p, index) => {
            if (p && camera) {
              const residual = tracking.patchMotion(sampleFrame.data, gray.data, gray.width, gray.height, p, camera);
              if (residual !== null) speeds[index] = residual / 8;
            }
            if (players[index]) return { ...players[index], missed: 0 };
            return p && camera && p.missed < 2 ? { x: p.x + camera.x, y: p.y + camera.y, missed: p.missed + 1 } : null;
          });
          if (sampleFrame) samples.push({ t, camera: !!camera, speeds });
          sampleFrame = gray;
          trackers.forEach((tracker, index) => {
            if (tracker) tracks[index].push({ t, x: (tracker.point.x - offset.x) / content.w, y: (tracker.point.y - offset.y) / content.h });
          });
        }
        previous = current;
        frame++;
        if (frame % motion.RATE === 0) onProgress(Math.min(1, frame / (request.len * motion.RATE)));
      }
    },
  });
  if (!frame) throw new Error('No frames available for player tracking.');
  // The first target is the highlighted player; only explicitly marked offensive targets establish a snap.
  const offensiveSamples = samples.map(s => ({ ...s, speeds: s.speeds.slice(1) }));
  const suggestion = tracking.suggestSnap(offensiveSamples, request.seeds.length - 1);
  if (request.seeds.length > 1 && !suggestion) warning.add('No reliable snap suggestion. Set the snap manually.');
  if (!tracks[0].length) warning.add('The selected player could not be tracked.');
  return { points: tracks[0], suggestion, warnings: [...warning], frames: frame };
}

if (!isMainThread) {
  const controller = new AbortController();
  parentPort.on('message', message => { if (message === 'cancel') controller.abort(); });
  analyzeFrames(workerData, { signal: controller.signal, onProgress: progress => parentPort.postMessage({ progress }) })
    .then(result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: error.message }))
    .finally(() => parentPort.close());
}

module.exports = { validateAnalysis, analyze, analyzeFrames };
