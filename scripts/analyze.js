#!/usr/bin/env node
'use strict';
/*
 * Analyze an A22 film from the command line and (optionally) export verification frames.
 *   node scripts/analyze.js <film.mp4> [--out dir] [--frames N] [--threshold 0.1] [--from-json analysis.json]
 * Writes <out>/analysis.json; with --frames, writes side-by-side JPGs (sideline | end zone)
 * at the start and middle of the first N pairs.
 */
const fs = require('fs');
const path = require('path');
const media = require('../src/main/media');
const { pairClips } = require('../src/shared/pairing');
const { ffmpegPath } = require('../src/main/ffpaths');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('usage: node scripts/analyze.js <film.mp4> [--out dir] [--frames N] [--threshold 0.1] [--from-json analysis.json]');
    process.exit(1);
  }
  const out = arg('--out', 'analysis-out');
  const frames = Number(arg('--frames', 0));
  const threshold = Number(arg('--threshold', 0.1));
  fs.mkdirSync(out, { recursive: true });

  let analysis;
  const fromJson = arg('--from-json');
  if (fromJson) {
    analysis = JSON.parse(fs.readFileSync(fromJson, 'utf8'));
    analysis.pairs = pairClips(analysis.clips);
  } else {
    const t0 = Date.now();
    let last = '';
    analysis = await media.analyzeFilm(file, {
      cutThreshold: threshold,
      onProgress: (p) => {
        const s = `${p.phase} ${Math.round(p.fraction * 100)}%`;
        if (s !== last) { process.stderr.write(`\r${s}      `); last = s; }
      },
    });
    process.stderr.write(`\nAnalyzed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }
  fs.writeFileSync(path.join(out, 'analysis.json'), JSON.stringify(analysis, null, 1));

  const { clips, pairs } = analysis;
  console.log(`clips=${clips.length} pairs=${pairs.length} fps=${analysis.info.fps.toFixed(3)} duration=${analysis.info.duration.toFixed(1)}s`);
  for (const p of pairs.slice(0, 40)) {
    const sl = p.sideline, ez = p.endzone;
    const or = (ids) => ids.map((i) => clips[i].orient).join('/');
    console.log(
      `#${String(p.index).padStart(3)} S ${sl.start.toFixed(2)}-${sl.end.toFixed(2)} (${(sl.end - sl.start).toFixed(1)}s o=${or(sl.clips)})  ` +
        `E ${ez.start.toFixed(2)}-${ez.end.toFixed(2)} (${(ez.end - ez.start).toFixed(1)}s o=${or(ez.clips)}) score=${p.score}`
    );
  }
  const used = new Set(pairs.flatMap((p) => [...p.sideline.clips, ...p.endzone.clips]));
  const unpaired = clips.filter((c) => !used.has(c.index));
  console.log(`unpaired clips: ${unpaired.map((c) => `${c.start.toFixed(1)}(${c.duration.toFixed(1)}s o=${c.orient})`).join(', ')}`);

  for (const p of pairs.slice(0, frames)) {
    for (const [tag, f] of [['start', 0.05], ['mid', 0.5]]) {
      const ls = p.sideline.end - p.sideline.start;
      const t1 = p.sideline.start + 0.05 + ls * f;
      const t2 = p.endzone.start + 0.05 + ls * f;
      const dest = path.join(out, `pair${String(p.index).padStart(3, '0')}_${tag}.jpg`);
      await media.run(ffmpegPath(), [
        '-y', '-v', 'error', '-ss', t1.toFixed(3), '-i', file, '-ss', t2.toFixed(3), '-i', file,
        '-filter_complex', '[0:v]scale=640:360[a];[1:v]scale=640:360[b];[a][b]hstack', '-frames:v', '1', dest,
      ]);
    }
  }
  if (frames) console.log(`wrote verification frames to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
