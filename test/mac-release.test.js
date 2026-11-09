'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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
  assert.match(notice, /Terminal.*Applications > Utilities.*Spotlight/);
  assert.match(notice, /xattr -dr com\.apple\.quarantine \/Applications\/AMP22\.app/);
  assert.doesNotMatch(notice, /spctl --master-disable|sudo xattr/);
  assert.match(notice, /Previously published installers are unchanged/);
  assert.equal(addNotice(''), `${notice}\n`);
  assert.throws(() => addNotice(null), /Expected release description text/);
});

test('manually added notices with other heading levels are preserved without duplication', () => {
  for (const heading of ['##', '###']) {
    const body = `${heading} macOS installation and Gatekeeper\n\n${notice.split('\n').slice(2).join('\n')}\n## What's Changed\nOriginal notes\n`;
    assert.equal(addNotice(body), body);
  }
  const changelog = '* Updated ### macOS installation and Gatekeeper documentation';
  assert.ok(addNotice(changelog).endsWith(changelog));
  assert.ok(addNotice(changelog).startsWith(notice));
});

test('real release workflow includes instructions on creation and existing-release uploads', {
  skip: process.platform === 'win32',
}, (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-release-notes-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'scripts'));
  fs.copyFileSync(path.join(root, 'scripts/mac-release-notice.js'), path.join(temp, 'scripts/mac-release-notice.js'));
  fs.mkdirSync(path.join(temp, 'release'));
  fs.writeFileSync(path.join(temp, 'release/AMP22.dmg'), 'test artifact');
  const bin = path.join(temp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.RELEASE_STATE, 'utf8'));
assert.equal(args[0], 'release');
assert.equal(args[2], 'v0.6.1');
state.calls.push(args[1]);
const save = () => fs.writeFileSync(process.env.RELEASE_STATE, JSON.stringify(state));
const notes = () => fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
switch (args[1]) {
  case 'view':
    save();
    if (!state.exists) process.exit(1);
    if (args.includes('--json')) {
      assert.equal(args[args.indexOf('--json') + 1], 'body');
      assert.ok(!args.includes('--jq'));
      process.stdout.write(JSON.stringify({ body: state.body }) + '\\n');
    }
    break;
  case 'create':
    assert.equal(state.exists, false);
    assert.ok(args.includes('--generate-notes'));
    assert.ok(args.includes('--latest'));
    state.body = notes() + '\\n' + state.generated;
    state.exists = true;
    save();
    break;
  case 'edit':
    assert.equal(state.exists, true);
    state.body = notes();
    save();
    break;
  case 'upload':
    assert.equal(state.exists, true);
    assert.ok(args.includes('--clobber'));
    save();
    break;
  default:
    assert.fail('Unexpected GitHub command');
}
`, { mode: 0o755 });
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
  const scripts = [...workflow.matchAll(/        run: \|\n((?:          [^\n]*\n?)+)/g)];
  const releaseScript = scripts.at(-1)[1].replace(/^          /gm, '');
  assert.ok(releaseScript.startsWith('tag="v$APP_VERSION"'));
  const stateFile = path.join(temp, 'state.json');
  const generated = '## What\'s Changed\n* Latest feature\n\n**Full Changelog**: https://github.com/apulianas/AMP22/compare/v0.6.0...v0.6.1\n';
  const manual = addNotice(generated).replace(/^### /, '## ');
  for (const original of [undefined, generated, manual, `${manual}\n\n`]) {
    fs.writeFileSync(stateFile, JSON.stringify({
      exists: original !== undefined, body: original, generated, calls: [],
    }));
    const execute = () => {
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', releaseScript], {
        cwd: temp,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, APP_VERSION: '0.6.1', GITHUB_SHA: 'test-commit', RELEASE_STATE: stateFile },
        encoding: 'utf8', timeout: 30000,
      });
      assert.equal(result.status, 0, result.error?.message || `${result.stdout}${result.stderr}`);
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    };
    const first = execute();
    assert.equal(first.body, original === undefined ? `${notice}\n${generated}` : addNotice(original));
    assert.ok(first.body.endsWith(generated) || first.body.endsWith(`${generated}\n\n`));
    assert.deepEqual(first.calls, original === undefined ? ['view', 'create'] : ['view', 'view', 'edit', 'upload']);
    const rerun = execute();
    assert.equal(rerun.body, first.body);
    assert.deepEqual(rerun.calls.slice(first.calls.length), ['view', 'view', 'edit', 'upload']);
    assert.equal((rerun.body.match(/^#{1,6} macOS installation and Gatekeeper$/gm) || []).length, 1);
  }
});

test('release workflow gates uploads on final DMG verification without any Apple secrets', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: false/);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target|notarize-mac-release/);
  assert.ok(workflow.indexOf('node scripts/verify-mac-release.js') < workflow.indexOf('actions/upload-artifact'));
  assert.match(workflow, /needs: \[version, build, extension\]/);
  assert.match(workflow, /if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/master'/);
  assert.match(workflow, /--notes-file release-notes\.md \\\n\s+--generate-notes/);
  assert.match(workflow, /gh release view "\$tag" --json body > release-notes\.json/);
  assert.match(workflow, /node scripts\/mac-release-notice\.js --release-json release-notes\.json > release-notes\.md/);
});
