'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { fixAsar } = require('../src/main/ffpaths');

test('media executable paths resolve outside ASAR on macOS and Windows', () => {
  assert.equal(fixAsar('/app/Resources/app.asar/node_modules/tool'), '/app/Resources/app.asar.unpacked/node_modules/tool');
  assert.equal(fixAsar('C:\\AMP22\\resources\\app.asar\\node_modules\\tool.exe'), 'C:\\AMP22\\resources\\app.asar.unpacked\\node_modules\\tool.exe');
  assert.equal(fixAsar('/app/Resources/app.asar.unpacked/tool'), '/app/Resources/app.asar.unpacked/tool');
  assert.equal(fixAsar('/development/tool'), '/development/tool');
  assert.equal(fixAsar(null), null);
});

test('media executable overrides take precedence over bundled paths', () => {
  const modulePath = path.resolve(__dirname, '../src/main/ffpaths');
  const output = execFileSync(process.execPath, ['-e', `
    const { ffmpegPath, ffprobePath } = require(${JSON.stringify(modulePath)});
    console.log(JSON.stringify([ffmpegPath(), ffprobePath()]));
  `], {
    encoding: 'utf8',
    env: { ...process.env, A22_FFMPEG: '/custom/ffmpeg', A22_FFPROBE: '/custom/ffprobe' },
  });
  assert.deepEqual(JSON.parse(output), ['/custom/ffmpeg', '/custom/ffprobe']);
});

test('default media paths use the configured binary packages', () => {
  const modulePath = path.resolve(__dirname, '../src/main/ffpaths');
  const env = { ...process.env };
  delete env.A22_FFMPEG;
  delete env.A22_FFPROBE;
  const output = execFileSync(process.execPath, ['-e', `
    const { ffmpegPath, ffprobePath } = require(${JSON.stringify(modulePath)});
    console.log(JSON.stringify([ffmpegPath(), ffprobePath()]));
  `], { encoding: 'utf8', env });
  assert.deepEqual(JSON.parse(output), [
    fixAsar(require('ffmpeg-static')),
    fixAsar(require('@derhuerst/ffprobe-static')),
  ]);
});

test('bundled media tools run and contain the native Mac architecture', () => {
  for (const [name, binary] of [
    ['ffmpeg', require('ffmpeg-static')],
    ['ffprobe', require('@derhuerst/ffprobe-static')],
  ]) {
    const version = execFileSync(binary, ['-version'], { encoding: 'utf8' });
    assert.match(version, new RegExp(`^${name} version `));
    if (process.platform === 'darwin') {
      const cpu = process.arch === 'arm64' ? 'arm64' : 'x86_64';
      execFileSync('lipo', ['-verify_arch', cpu, binary]);
    }
  }
});
