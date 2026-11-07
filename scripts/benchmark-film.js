#!/usr/bin/env node
'use strict';

// Benchmark-only instrumentation: production media commands remain unchanged.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { performance } = require('node:perf_hooks');

function options(argv) {
  const [file, ...rest] = argv;
  const o = { file, mode: 'full', threads: 'auto', filterThreads: 'auto', hardware: 'none', samples: 40 };
  const names = new Map([
    ['--out', 'out'], ['--mode', 'mode'], ['--threads', 'threads'],
    ['--filter-threads', 'filterThreads'], ['--hardware', 'hardware'],
    ['--scan-filter-threads', 'scanFilterThreads'],
    ['--seconds', 'seconds'], ['--start', 'start'], ['--analysis', 'analysis'], ['--samples', 'samples'],
  ]);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--batch') o.batch = true;
    else {
      const key = names.get(rest[i]);
      if (!key || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Invalid option: ${rest[i]}`);
      o[key] = rest[++i];
    }
  }
  if (!file || file.startsWith('--') || !o.out) throw new Error('Film and --out (new directory) are required.');
  if (!['full', 'scan', 'classify'].includes(o.mode)) throw new Error('Invalid mode');
  if (!['none', 'videotoolbox', 'download'].includes(o.hardware)) throw new Error('Invalid hardware mode');
  for (const key of ['threads', 'filterThreads', 'scanFilterThreads']) {
    if (o[key] === undefined) continue;
    if (o[key] !== 'auto' && !/^[1-9]\d*$/.test(o[key])) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['seconds', 'start', 'samples']) {
    if (o[key] !== undefined && (!Number.isFinite(Number(o[key])) || Number(o[key]) < (key === 'start' ? 0 : 1))) {
      throw new Error(`Invalid ${key}`);
    }
  }
  if (!Number.isInteger(Number(o.samples))) throw new Error('Sample count must be an integer');
  if (o.mode === 'classify' && !o.analysis) throw new Error('--analysis is required for classification.');
  if (o.mode !== 'scan' && (o.seconds || o.start)) throw new Error('Window options require --mode scan.');
  if (o.mode === 'scan' && o.batch) throw new Error('Batch sampling requires classification.');
  return o;
}

async function main() {
  const o = options(process.argv.slice(2));
  const { ffmpegPath, ffprobePath } = require('../src/main/ffpaths');
  const ffmpeg = ffmpegPath();
  const originalSpawn = cp.spawn;
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const processes = cp.execFileSync('/bin/ps', ['-axo', 'pid,comm'], { encoding: 'utf8' });
  if (processes.split('\n').some((s) => /\/(?:ffmpeg|ffprobe|AMP22|Electron)$/.test(s.trim()))) {
    throw new Error('Another media/app job is running. Stop it before benchmarking.');
  }
  const statBefore = fs.statSync(o.file);
  if (!statBefore.isFile()) throw new Error('Film must be a regular file');
  fs.mkdirSync(o.out, { recursive: false });
  const report = {
    options: { ...o, file: path.basename(o.file), out: undefined, analysis: o.analysis && path.basename(o.analysis) },
    startedAt: new Date().toISOString(),
    revision: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    mediaHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../src/main/media.js'))).digest('hex'),
    host: { model: os.cpus()[0].model, cpus: os.cpus().length, memory: os.totalmem(), platform: os.release(), node: process.version },
    ffmpeg: cp.execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n').slice(0, 3),
    film: { bytes: statBefore.size, mtimeMs: statBefore.mtimeMs },
    cache: 'Fresh Node process and uncached analysis; OS page cache not purged or controlled. No pre-read of film.',
    phases: [], commands: [], samples: [], interference: [],
  };
  let phase;
  let phaseStart;
  function transition(name) {
    if (phase) report.phases.push({ phase, seconds: (performance.now() - phaseStart) / 1000 });
    phase = name;
    phaseStart = performance.now();
    console.log(`${new Date().toISOString()} ${name}`);
  }
  const active = new Set();
  const timer = setInterval(() => {
    report.samples.push({ phase, seconds: (performance.now() - started) / 1000, load: os.loadavg(), freeMemory: os.freemem() });
    const snapshot = cp.spawnSync('/bin/ps', ['-axo', 'pid,ppid,comm'], { encoding: 'utf8' });
    if (snapshot.status !== 0) {
      report.interference.push({ phase, error: 'Could not check for competing jobs' });
      controller.abort();
      return;
    }
    for (const line of snapshot.stdout.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (m && /\/(?:ffmpeg|ffprobe|AMP22|Electron)$/.test(m[3]) && !active.has(Number(m[2]))) {
        report.interference.push({ phase, seconds: (performance.now() - started) / 1000, pid: Number(m[1]), command: path.basename(m[3]) });
        controller.abort();
      }
    }
  }, 2000);
  const started = performance.now();
  cp.spawn = (cmd, inputArgs, spawnOptions) => {
    const args = [...inputArgs];
    const isScan = cmd === ffmpeg && args.includes('-skip_frame');
    const isGrab = cmd === ffmpeg && args.includes('rawvideo');
    if (isScan || isGrab) {
      for (let i = args.length - 1; i >= 0; i--) {
        if (args[i] !== '-i') continue;
        const extra = [];
        if (o.threads !== 'auto') extra.push('-threads', o.threads);
        if (o.hardware !== 'none') extra.push('-hwaccel', 'videotoolbox');
        if (o.hardware === 'download') extra.push('-hwaccel_output_format', 'videotoolbox_vld');
        if (isScan && o.start) extra.push('-ss', o.start);
        args.splice(i, 0, ...extra);
      }
      if (isScan && o.seconds) args.splice(args.indexOf('-an'), 0, '-t', o.seconds);
      const filterThreads = isScan && o.scanFilterThreads !== undefined ? o.scanFilterThreads : o.filterThreads;
      if (isScan && (o.scanFilterThreads !== undefined || o.filterThreads !== 'auto')) {
        const index = args.indexOf('-filter_threads');
        if (index >= 0) args.splice(index, 2);
      }
      if (filterThreads !== 'auto') args.unshift('-filter_threads', filterThreads, '-filter_complex_threads', filterThreads);
      if (o.hardware === 'download') {
        const i = args.indexOf('-vf');
        if (i >= 0) args[i + 1] = `hwdownload,format=nv12,${args[i + 1]}`;
        const j = args.indexOf('-filter_complex');
        if (j >= 0) args[j + 1] = args[j + 1].replace(/(\[\d+:v:0\])/g, '$1hwdownload,format=nv12,');
      }
    }
    const record = {
      phase, command: cmd === ffmpeg ? 'ffmpeg' : cmd === ffprobePath() ? 'ffprobe' : cmd,
      args: args.map((s) => s === o.file ? '<film>' : s), frames: [],
    };
    report.commands.push(record);
    const t = performance.now();
    const child = originalSpawn('/usr/bin/time', ['-p', cmd, ...args], spawnOptions);
    active.add(child.pid);
    const kill = child.kill.bind(child);
    child.kill = (signal) => {
      // Killing time alone would leave its FFmpeg child decoding after cancellation.
      if (child.exitCode === null && child.signalCode === null) {
        const children = cp.spawnSync('/bin/ps', ['-o', 'pid=', '-P', String(child.pid)], { encoding: 'utf8' });
        for (const pid of (children.stdout || '').trim().split(/\s+/).filter(Boolean)) {
          try { process.kill(Number(pid), signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
        }
      }
      return kill(signal);
    };
    let stderr = '';
    const buffers = [];
    child.stderr.on('data', (b) => { stderr = (stderr + b).slice(-16000); });
    if (isGrab) child.stdout.on('data', (b) => buffers.push(b));
    child.on('close', (code) => {
      active.delete(child.pid);
      record.seconds = (performance.now() - t) / 1000;
      record.code = code;
      const m = /real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys\s+([\d.]+)/.exec(stderr);
      if (m) {
        record.userSeconds = Number(m[2]);
        record.systemSeconds = Number(m[3]);
      }
      if (isGrab) {
        const bytes = Buffer.concat(buffers);
        record.bytes = bytes.length;
        for (let i = 0; i < bytes.length; i += 320 * 180) {
          record.frames.push(crypto.createHash('sha256').update(bytes.subarray(i, i + 320 * 180)).digest('hex'));
        }
      }
      if (code !== 0) record.error = stderr;
    });
    return child;
  };
  // media captures spawn at load time; patching is confined to this CLI process.
  const pairing = require('../src/shared/pairing');
  const originalPairClips = pairing.pairClips;
  pairing.pairClips = (...args) => {
    transition('pair');
    return originalPairClips(...args);
  };
  const media = require('../src/main/media');
  const scenes = require('../src/shared/scenes');
  const orientation = require('../src/shared/orientation');
  const { pairClips } = require('../src/shared/pairing');
  const signal = controller.signal;
  let analysis;
  try {
    if (o.mode === 'full' && !o.batch) {
      analysis = await media.analyzeFilm(o.file, {
        signal, cutThreshold: 0.1,
        onProgress: (p) => { if (p.phase !== phase) transition(p.phase); },
      });
    } else if (o.mode === 'scan') {
      transition('probe');
      const info = await media.probe(o.file);
      transition('scan');
      const candidates = await media.detectScenes(o.file, Number(o.seconds) || info.duration, { signal });
      analysis = { info, candidates, cuts: scenes.cutsFromScores(candidates, { threshold: 0.1, minGap: 0.4 }) };
    } else {
      if (o.mode === 'full') {
        transition('probe');
        const info = await media.probe(o.file);
        transition('scan');
        const candidates = await media.detectScenes(o.file, info.duration, { signal });
        const cuts = scenes.cutsFromScores(candidates, { threshold: 0.1, minGap: 0.4 });
        analysis = { info, candidates, clips: scenes.clipsFromCuts(cuts.map((c) => c.time), info.duration) };
      } else {
        analysis = JSON.parse(fs.readFileSync(o.analysis, 'utf8'));
        if (Number(o.samples) < analysis.clips.length) {
          const clips = analysis.clips;
          analysis.clips = Array.from({ length: Number(o.samples) }, (_, i) =>
            clips[Math.floor(i * clips.length / Number(o.samples))]);
        }
      }
      transition('classify');
      if (!o.batch) await media.classifyClips(o.file, analysis.clips, { signal });
      else {
        await media.mapLimit(analysis.clips, 4, async (clip) => {
          if (clip.duration < 1) { clip.orient = null; return; }
          const times = [0.35, 0.65].map((f) => clip.start + clip.duration * f);
          const args = ['-hide_banner', '-v', 'error'];
          for (const t of times) args.push('-ss', t.toFixed(3), '-i', o.file);
          const filters = times.map((_, i) =>
            `[${i}:v:0]trim=end_frame=1,scale=320:180,format=gray,setpts=PTS-STARTPTS[s${i}]`);
          filters.push('[s0][s1]concat=n=2:v=1:a=0[out]');
          args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', '2',
            '-fps_mode', 'passthrough', '-an', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1');
          const { stdout } = await media.run(ffmpeg, args, { binary: true, signal });
          if (stdout.length !== 2 * 320 * 180) throw new Error(`Expected two complete frames, received ${stdout.length} bytes`);
          const scores = [0, 1].map((i) => orientation.features(stdout.subarray(i * 320 * 180, (i + 1) * 320 * 180), 320, 180).score);
          clip.orient = Math.round((scores[0] + scores[1]) / 2 * 1000) / 1000;
        });
      }
      analysis.pairs = pairClips(analysis.clips);
    }
    if (phase !== 'done') transition('done');
    if (report.commands.some((c) => c.code !== 0)) throw new Error('A media subprocess failed; see metrics.json');
    if (report.commands.some((c) => c.bytes !== undefined && c.bytes !== Number(c.args[c.args.indexOf('-frames:v') + 1]) * 320 * 180)) {
      throw new Error('Incomplete orientation frame output; see metrics.json');
    }
    const after = fs.statSync(o.file);
    if (after.size !== statBefore.size || after.mtimeMs !== statBefore.mtimeMs) throw new Error('Source film changed during benchmark');
    fs.writeFileSync(path.join(o.out, 'analysis.json'), JSON.stringify(analysis));
  } catch (error) {
    controller.abort();
    report.error = error.stack;
    throw error;
  } finally {
    clearInterval(timer);
    cp.spawn = originalSpawn;
    report.seconds = (performance.now() - started) / 1000;
    for (const p of report.phases) {
      const commands = report.commands.filter((c) => c.phase === p.phase);
      p.cpuSeconds = commands.reduce((sum, c) => sum + (c.userSeconds || 0) + (c.systemSeconds || 0), 0);
      p.cpuPercent = p.cpuSeconds / p.seconds * 100;
    }
    fs.writeFileSync(path.join(o.out, 'metrics.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ seconds: report.seconds, phases: report.phases, error: report.error }));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { options };
