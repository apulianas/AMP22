'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { downloadAssets } = require('./download-ci-media');

// Match the toolset pins in the locked electron-builder; review on upgrades.
function toolAssets(platform, arch) {
  if (platform === 'darwin') {
    assert.ok(['arm64', 'x64'].includes(arch), 'macOS CI requires arm64 or x64');
    const cpu = arch === 'arm64' ? 'arm64' : 'x86_64';
    return [
      ['7zip@1.0.0', `7zip-darwin-${cpu}.tar.gz`],
      ['dmg-builder@1.2.5', `dmgbuild-bundle-${cpu}-75c8a6c.tar.gz`],
    ];
  }
  assert.equal(platform, 'win32', 'CI installer preparation supports macOS and Windows');
  assert.equal(arch, 'x64', 'Windows CI requires x64');
  return [
    ['7zip@1.0.0', '7zip-win-x64.tar.gz'],
    ['winCodeSign-2.6.0', 'winCodeSign-2.6.0.7z'],
    ['nsis-3.0.4.1', 'nsis-3.0.4.1.7z'],
    ['nsis-resources-3.4.1', 'nsis-resources-3.4.1.7z'],
  ];
}

async function prepareBuilder(root = path.join(__dirname, '..'), download = downloadAssets) {
  const readPackage = (name) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
  assert.equal(readPackage('app-builder-lib').version, '26.18.0',
    'Review CI toolset asset pins when upgrading electron-builder');
  const { version } = readPackage('electron');
  const file = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const checksums = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'));
  assert.match(checksums[file], /^[a-f0-9]{64}$/, 'Missing locked Electron checksum');
  const directory = path.join(root, 'out/ci-builder/electron');
  fs.mkdirSync(directory, { recursive: true });
  await download('electron/electron', `v${version}`, [file], directory);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(path.join(directory, file))) hash.update(chunk);
  assert.equal(hash.digest('hex'), checksums[file], 'Electron archive checksum mismatch');
  console.log(`Verified ${file} against the locked npm checksum manifest.`);
  for (const [release, asset] of toolAssets(process.platform, process.arch)) {
    const cache = path.join(root, 'out/ci-builder/cache', release);
    fs.mkdirSync(cache, { recursive: true });
    await download('electron-userland/electron-builder-binaries', release, [asset], cache);
    assert.ok(fs.statSync(path.join(cache, asset)).isFile(), `Missing installer tool: ${asset}`);
  }
}

if (require.main === module) {
  prepareBuilder().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { prepareBuilder, toolAssets };
