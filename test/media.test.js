'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, analyzeFilm, detectScenes } = require('../src/main/media');
const { ffmpegPath } = require('../src/main/ffpaths');
const scenes = require('../src/shared/scenes');

test('film analysis honors a cut threshold below the usual candidate floor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-weak-cuts-'));
  try {
    const file = path.join(dir, 'weak-cuts.mp4');
    await run(ffmpegPath(), [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x202020:s=64x36:r=10:d=2',
      '-f', 'lavfi', '-i', 'color=c=0x252525:s=64x36:r=10:d=2',
      '-f', 'lavfi', '-i', 'color=c=0x202020:s=64x36:r=10:d=2',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0', '-c:v', 'libx264', '-crf', '0', file,
    ]);
    const sensitive = await analyzeFilm(file, { cutThreshold: 0.03 });
    assert.equal(sensitive.clips.length, 3);
    assert.equal(sensitive.candidates.length, 2);
    for (const [i, cut] of sensitive.candidates.entries()) {
      assert.ok(cut.score >= 0.03 && cut.score < 0.06);
      assert.ok(Math.abs(cut.time - (i + 1) * 2) < 0.15);
    }
    const normal = await analyzeFilm(file, { cutThreshold: 0.1 });
    assert.equal(normal.clips.length, 1);
    assert.equal(normal.candidates.length, 0);

    const vf = "scale=64:36,select='gt(scene\\,0.03)',metadata=print:key=lavfi.scene_score";
    const { stderr } = await run(ffmpegPath(), [
      '-hide_banner', '-nostats', '-v', 'info', '-skip_frame', 'noref', '-i', file,
      '-an', '-sn', '-dn', '-vf', vf, '-f', 'null', '-',
    ]);
    assert.deepEqual(await detectScenes(file, 6, { candidateThreshold: 0.03 }), scenes.parseMetadataLog(stderr));

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(detectScenes(file, 6, { signal: controller.signal }), { cancelled: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
