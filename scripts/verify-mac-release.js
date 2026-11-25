'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../package.json');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout || ''}${result.stderr || ''}`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function verifySignature(file, execute = run) {
  execute('codesign', ['--verify', '--deep', '--strict', '--verbose=2', file]);
  // codesign writes signature details to stderr, even on success.
  const details = execute('codesign', ['--display', '--verbose=4', file]);
  assert.match(details, /^Authority=Developer ID Application: .+$/m, 'Expected a Developer ID Application signature');
  assert.match(details, /^TeamIdentifier=[A-Z0-9]{10}$/m, 'Expected an Apple Team ID');
  assert.match(details, /^CodeDirectory .*\bflags=.*\bruntime\b/m, 'Expected hardened runtime (required for notarization)');
  return details.match(/^TeamIdentifier=(.+)$/m)[1];
}

function verifyApp(app, arch, execute = run) {
  const team = verifySignature(app, execute);
  const contents = path.join(app, 'Contents');
  const media = path.join(contents, 'Resources/app.asar.unpacked/node_modules');
  const binaries = [
    path.join(contents, 'MacOS/AMP22'),
    path.join(media, 'ffmpeg-static/ffmpeg'),
    path.join(media, '@derhuerst/ffprobe-static/ffprobe'),
  ];
  if (arch === 'arm64') binaries.push(path.join(contents, 'Resources/native/amp22-foundation-models'));
  for (const name of fs.readdirSync(path.join(contents, 'Frameworks'))) {
    if (name.endsWith('.app') || name.endsWith('.framework')) binaries.push(path.join(contents, 'Frameworks', name));
  }
  for (const binary of binaries) {
    assert.equal(verifySignature(binary, execute), team, `${path.basename(binary)} is signed by a different team`);
  }
  execute('xcrun', ['stapler', 'validate', app]);
  const assessment = execute('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  assert.match(assessment, /source=Notarized Developer ID/, 'Gatekeeper did not accept the app as notarized');
}

function verifyRelease(arch, execute = run) {
  assert.ok(['arm64', 'x64'].includes(arch), 'Expected architecture: arm64 or x64');
  const dmg = path.resolve('dist', `AMP22-${config.version}-${arch}.dmg`);
  assert.ok(fs.statSync(dmg).isFile(), 'Expected release DMG is missing');
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-release-'));
  let attached = false;
  try {
    execute('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
    attached = true;
    verifyApp(path.join(mount, 'AMP22.app'), arch, execute);
  } finally {
    if (attached) execute('hdiutil', ['detach', mount]);
    fs.rmdirSync(mount);
  }
}

if (require.main === module) {
  try {
    assert.equal(process.platform, 'darwin', 'macOS release verification must run on macOS');
    verifyRelease(process.argv[2]);
    console.log('DMG app is Developer ID signed (hardened runtime, one Team ID across helpers and media tools), notarized, stapled, and accepted by Gatekeeper.');
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifySignature, verifyApp, verifyRelease };
