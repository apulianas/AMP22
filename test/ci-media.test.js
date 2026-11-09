'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { installMedia } = require('../scripts/download-ci-media');
const { prepareBuilder, toolAssets } = require('../scripts/download-ci-builder');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-ci-media-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, tool, release] of [
    ['ffmpeg-static', 'ffmpeg', 'b6.1.1'],
    ['@derhuerst/ffprobe-static', 'ffprobe', 'b6.0'],
  ]) {
    const directory = path.join(root, 'node_modules', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
      [name]: { 'binary-release-tag': release, 'executable-base-name': tool },
    }));
  }
  const downloads = [];
  const verified = [];
  const execute = (command, args) => {
    if (command !== 'gh') {
      assert.deepEqual(args, ['-version']);
      const tool = path.basename(command).replace(/\.exe$/, '');
      assert.equal(fs.readFileSync(command, 'utf8'), `${tool} binary`);
      assert.equal(fs.readFileSync(`${command}.LICENSE`, 'utf8'), 'license');
      assert.equal(fs.readFileSync(`${command}.README`, 'utf8'), 'readme');
      if (process.platform !== 'win32') assert.equal(fs.statSync(command).mode & 0o777, 0o755);
      verified.push(tool);
      return `${tool} version 6.1.1`;
    }
    downloads.push(args);
    assert.deepEqual(args.slice(0, 2), ['release', 'download']);
    assert.equal(args[args.indexOf('--repo') + 1], 'eugeneware/ffmpeg-static');
    assert.ok(args.includes('--clobber'));
    const archive = args[args.indexOf('--pattern') + 1];
    const tool = archive.split('-')[0];
    assert.equal(args[2], tool === 'ffmpeg' ? 'b6.1.1' : 'b6.0');
    assert.equal(archive, `${tool}-${process.platform}-${process.arch}.gz`);
    const temp = args[args.indexOf('--dir') + 1];
    fs.writeFileSync(path.join(temp, archive), gzipSync(`${tool} binary`));
    fs.writeFileSync(path.join(temp, `${process.platform}-${process.arch}.LICENSE`), 'license');
    fs.writeFileSync(path.join(temp, `${process.platform}-${process.arch}.README`), 'readme');
  };
  return { root, execute, downloads, verified };
}

test('CI installs both native tools using each locked release and retains licenses', async (t) => {
  const { root, execute, downloads, verified } = fixture(t);
  await installMedia(root, execute, () => assert.fail('must not wait on success'));
  assert.equal(downloads.length, 2);
  assert.deepEqual(verified, ['ffmpeg', 'ffprobe']);
  for (const args of downloads) {
    assert.equal(fs.existsSync(args[args.indexOf('--dir') + 1]), false);
  }
});

test('transient API download failures retry with bounded backoff', async (t) => {
  const { root, execute, verified } = fixture(t);
  let attempts = 0;
  const waits = [];
  await installMedia(root, (command, args) => {
    if (command === 'gh' && ++attempts < 3) throw new Error('HTTP 504');
    return execute(command, args);
  }, async (ms) => waits.push(ms));
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [20000, 40000]);
  assert.deepEqual(verified, ['ffmpeg', 'ffprobe']);
});

test('exhausted downloads fail after three attempts and clean temporary files', async (t) => {
  const { root, verified } = fixture(t);
  let attempts = 0;
  let temp;
  const waits = [];
  await assert.rejects(installMedia(root, (command, args) => {
    assert.equal(command, 'gh');
    attempts++;
    temp = args[args.indexOf('--dir') + 1];
    throw new Error('HTTP 504');
  }, async (ms) => waits.push(ms)), /HTTP 504/);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [20000, 40000]);
  assert.deepEqual(verified, []);
  assert.equal(fs.existsSync(temp), false);
});

test('invalid archives and unusable media tools cannot produce a successful install', async (t) => {
  for (const failure of ['archive', 'executable']) {
    const { root, execute } = fixture(t);
    await assert.rejects(installMedia(root, (command, args) => {
      if (command !== 'gh' && failure === 'executable') throw new Error('cannot execute binary');
      const result = execute(command, args);
      if (command === 'gh' && failure === 'archive') {
        const temp = args[args.indexOf('--dir') + 1];
        fs.writeFileSync(path.join(temp, args[args.indexOf('--pattern') + 1]), 'HTTP error, not gzip');
      }
      return result;
    }, () => assert.fail('must not retry validation failures')), failure === 'archive' ? /header/ : /cannot execute/);
  }
});

test('workflow runs install scripts before tests and verifies file-first Mac architectures', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build.yml'), 'utf8');
  const packages = workflow.indexOf('npm ci --ignore-scripts');
  const media = workflow.indexOf('node scripts/download-ci-media.js');
  const rebuild = workflow.indexOf('npm rebuild --foreground-scripts');
  assert.ok(packages > 0 && packages < media && media < rebuild && rebuild < workflow.indexOf('npm test'));
  assert.match(workflow, /lipo "\$binary" -verify_arch "\$cpu"/);
  assert.doesNotMatch(workflow, /lipo -verify_arch/);
  assert.match(workflow, /electron-builder --config scripts\/ci-builder-config\.js/);
  assert.ok(workflow.indexOf('node scripts/download-ci-builder.js') < workflow.indexOf('electron-builder --config'));
  assert.match(workflow, /ELECTRON_BUILDER_CACHE: \$\{\{ github\.workspace \}\}\/out\/ci-builder\/cache/);
});

test('CI verifies every Electron target against the locked package checksum manifest', () => {
  const config = require('../scripts/ci-builder-config');
  const { version } = require('electron/package.json');
  assert.equal(config.electronVersion, version);
  assert.deepEqual(config.electronDownload.checksums, require('electron/checksums.json'));
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
    assert.match(config.electronDownload.checksums[`electron-v${version}-${target}.zip`], /^[a-f0-9]{64}$/);
  }
  assert.equal(config.electronDownload.unsafelyDisableChecksums, undefined);
  assert.equal(config.mac.identity, '-');
  assert.equal(config.mac.strictVerify, true);
  assert.deepEqual(config.asarUnpack, require('../package.json').build.asarUnpack);
});

test('CI fetches and verifies Electron before seeding the native installer archive cache', {
  skip: !['darwin', 'win32'].includes(process.platform),
}, async (t) => {
  const { root } = fixture(t);
  const bytes = Buffer.from('Electron archive fixture');
  const file = `electron-v45.0.0-${process.platform}-${process.arch}.zip`;
  for (const [name, version] of [['electron', '45.0.0'], ['app-builder-lib', '26.18.0']]) {
    fs.mkdirSync(path.join(root, 'node_modules', name));
    fs.writeFileSync(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ version }));
  }
  fs.writeFileSync(path.join(root, 'node_modules/electron/checksums.json'), JSON.stringify({
    [file]: createHash('sha256').update(bytes).digest('hex'),
  }));
  const calls = [];
  const download = async (repo, release, files, directory) => {
    calls.push([repo, release, files, directory]);
    fs.writeFileSync(path.join(directory, files[0]), bytes);
  };
  await prepareBuilder(root, download);
  assert.deepEqual(calls[0].slice(0, 3), ['electron/electron', 'v45.0.0', [file]]);
  const tools = toolAssets(process.platform, process.arch);
  assert.equal(calls.length, tools.length + 1);
  for (const [index, [release, asset]] of tools.entries()) {
    assert.deepEqual(calls[index + 1], ['electron-userland/electron-builder-binaries', release, [asset],
      path.join(root, 'out/ci-builder/cache', release)]);
  }
  calls.length = 0;
  await assert.rejects(prepareBuilder(root, async (...args) => {
    await download(...args);
    fs.writeFileSync(path.join(args[3], file), 'corrupted Electron archive');
  }), /checksum mismatch/);
  assert.equal(calls.length, 1);
  fs.writeFileSync(path.join(root, 'node_modules/app-builder-lib/package.json'), '{"version":"27.0.0"}');
  await assert.rejects(prepareBuilder(root, () => assert.fail('must review new toolset pins first')), /upgrading electron-builder/);
});

test('installer cache pins cover both Mac architectures and Windows and reject unsupported targets', () => {
  assert.deepEqual(toolAssets('darwin', 'arm64'), [
    ['7zip@1.0.0', '7zip-darwin-arm64.tar.gz'],
    ['dmg-builder@1.2.5', 'dmgbuild-bundle-arm64-75c8a6c.tar.gz'],
  ]);
  assert.deepEqual(toolAssets('darwin', 'x64'), [
    ['7zip@1.0.0', '7zip-darwin-x86_64.tar.gz'],
    ['dmg-builder@1.2.5', 'dmgbuild-bundle-x86_64-75c8a6c.tar.gz'],
  ]);
  assert.deepEqual(toolAssets('win32', 'x64'), [
    ['7zip@1.0.0', '7zip-win-x64.tar.gz'],
    ['winCodeSign-2.6.0', 'winCodeSign-2.6.0.7z'],
    ['nsis-3.0.4.1', 'nsis-3.0.4.1.7z'],
    ['nsis-resources-3.4.1', 'nsis-resources-3.4.1.7z'],
  ]);
  assert.throws(() => toolAssets('linux', 'x64'), /supports macOS and Windows/);
  assert.throws(() => toolAssets('darwin', 'ia32'), /macOS CI requires/);
  assert.throws(() => toolAssets('win32', 'arm64'), /Windows CI requires/);
});
