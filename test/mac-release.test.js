'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../package.json');
const { verifySignature, verifyApp, verifyRelease } = require('../scripts/verify-mac-release');
const { notice, addNotice } = require('../scripts/mac-release-notice');

const root = path.join(__dirname, '..');
const signature = 'CodeDirectory v=20400 size=123 flags=0x2(adhoc) hashes=3+2 location=embedded\nSignature=adhoc\n';

test('macOS uses free ad-hoc signing without hardened runtime or notarization', () => {
  assert.equal(config.build.mac.identity, '-');
  assert.equal(config.build.mac.hardenedRuntime, false);
  assert.equal(config.build.mac.notarize, false);
  assert.equal(config.build.mac.strictVerify, true);
  assert.equal(config.build.mac.signIgnore, undefined);
  assert.deepEqual(config.build.asarUnpack, ['node_modules/ffmpeg-static/**', 'node_modules/ffprobe-static/**']);
  assert.equal(config.build.dmg.sign, undefined);
  assert.equal(config.build.win.target[0].target, 'nsis');
});

test('signature verification is strict and rejects missing/ad-hoc hardened signatures', () => {
  const calls = [];
  verifySignature('/AMP22.app', (command, args) => {
    calls.push([command, args]);
    return signature;
  });
  assert.deepEqual(calls[0], ['codesign', ['--verify', '--deep', '--strict', '--verbose=2', '/AMP22.app']]);
  assert.deepEqual(calls[1], ['codesign', ['--display', '--verbose=4', '/AMP22.app']]);
  assert.throws(() => verifySignature('/AMP22.app', () => ''), /ad-hoc signature/);
  assert.throws(() => verifySignature('/AMP22.app', () => signature.replace('0x2(adhoc)', '0x10002(adhoc,runtime)')), /hardened runtime/);
  assert.throws(() => verifySignature('/AMP22.app', () => { throw new Error('invalid resource seal'); }), /invalid resource seal/);
});

test('checks main executable, both media tools, Electron helpers and frameworks for each architecture', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-signatures-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const app = path.join(temp, 'AMP22.app');
  const frameworks = path.join(app, 'Contents/Frameworks');
  fs.mkdirSync(frameworks, { recursive: true });
  for (const name of ['AMP22 Helper.app', 'AMP22 Helper (Renderer).app', 'Electron Framework.framework']) {
    fs.mkdirSync(path.join(frameworks, name));
  }
  for (const arch of ['arm64', 'x64']) {
    const verified = [];
    verifyApp(app, arch, (command, args) => {
      assert.equal(command, 'codesign');
      if (args.includes('--verify')) verified.push(args.at(-1));
      return signature;
    });
    assert.equal(verified.length, 7);
    assert.ok(verified.includes(app));
    assert.ok(verified.includes(path.join(app, 'Contents/MacOS/AMP22')));
    assert.ok(verified.includes(path.join(app, 'Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')));
    assert.ok(verified.includes(path.join(app, `Contents/Resources/app.asar.unpacked/node_modules/ffprobe-static/bin/darwin/${arch}/ffprobe`)));
    assert.ok(verified.includes(path.join(frameworks, 'AMP22 Helper (Renderer).app')));
  }
});

test('DMG verifier rejects unsupported architectures before mounting anything', () => {
  assert.throws(() => verifyRelease('universal', () => assert.fail('must not execute')), /Expected architecture/);
});

test('release notice preserves existing notes and links and is idempotent', () => {
  const body = '## What\'s Changed\n* Analysis Lab\n\n**Full Changelog**: https://github.com/apulianas/AMP22/compare/v0.5.2...v0.6.0';
  const updated = addNotice(body);
  assert.ok(updated.endsWith(body));
  assert.equal(addNotice(updated), updated);
  assert.match(notice, /not Apple Developer ID signed or notarized/);
  assert.match(notice, /only if you trust this official AMP22 GitHub release/);
  assert.match(notice, /xattr -dr com\.apple\.quarantine \/Applications\/AMP22\.app/);
  assert.doesNotMatch(notice, /spctl --master-disable|sudo xattr/);
  assert.match(notice, /Previously published installers are unchanged/);
});

test('release workflow gates uploads on final DMG verification without any Apple secrets', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: false/);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target|notarize-mac-release/);
  assert.ok(workflow.indexOf('node scripts/verify-mac-release.js') < workflow.indexOf('actions/upload-artifact'));
  assert.match(workflow, /needs: \[version, build, extension\]/);
  assert.match(workflow, /if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/master'/);
  assert.match(workflow, /--notes-file release-notes\.md \\\n\s+--generate-notes/);
  assert.match(workflow, /gh release view "\$tag" --json body --jq \.body/);
  assert.match(workflow, /node scripts\/mac-release-notice\.js release-notes\.md/);
});
