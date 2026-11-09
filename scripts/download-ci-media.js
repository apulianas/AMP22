'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { gunzipSync } = require('node:zlib');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout || ''}${result.stderr || ''}`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function installMedia(root = path.join(__dirname, '..'), execute = run, wait = delay) {
  for (const name of ['ffmpeg-static', '@derhuerst/ffprobe-static']) {
    const directory = path.join(root, 'node_modules', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const metadata = pkg[name];
    const release = metadata['binary-release-tag'];
    const tool = metadata['executable-base-name'];
    assert.ok(typeof release === 'string' && release.length > 0, `Missing locked binary release for ${name}`);
    assert.ok(['ffmpeg', 'ffprobe'].includes(tool), `Unexpected media executable for ${name}`);
    const target = `${process.platform}-${process.arch}`;
    const archive = `${tool}-${target}.gz`;
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-media-'));
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          execute('gh', ['release', 'download', release, '--repo', 'eugeneware/ffmpeg-static',
            '--pattern', archive, '--pattern', `${target}.README`, '--pattern', `${target}.LICENSE`,
            '--dir', temp, '--clobber']);
          break;
        } catch (error) {
          console.error(`${name} download attempt ${attempt}/3 failed: ${error.message}`);
          if (attempt === 3) throw error;
          await wait(attempt * 20000);
        }
      }
      const binary = path.join(directory, tool + (process.platform === 'win32' ? '.exe' : ''));
      fs.writeFileSync(binary, gunzipSync(fs.readFileSync(path.join(temp, archive))), { mode: 0o755 });
      for (const suffix of ['README', 'LICENSE']) {
        fs.copyFileSync(path.join(temp, `${target}.${suffix}`), `${binary}.${suffix}`);
      }
      assert.match(execute(binary, ['-version']), new RegExp(`^${tool} version `));
      console.log(`Installed and verified ${tool} ${release} for ${target} through the GitHub asset API.`);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  installMedia().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { installMedia };
