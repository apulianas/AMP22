'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UpdateService, isNewer } = require('../src/main/updates');

function service(options = {}) {
  const state = { stored: {}, requests: [], opened: [] };
  const release = {
    tag_name: 'v0.2.4', draft: false, prerelease: false,
    body: "## What's Changed\n* Improved film controls\n<script>not HTML</script>",
    html_url: 'https://untrusted.example/download',
  };
  const updates = new UpdateService({
    version: '0.2.3',
    packaged: true,
    fetch: async (url, opts) => {
      state.requests.push({ url, opts });
      return { ok: true, json: async () => release };
    },
    store: { get: () => state.stored, set: (value) => { state.stored = value; } },
    openExternal: async (url) => { state.opened.push(url); },
    ...options,
  });
  return { updates, state, release };
}

test('stable versions compare numerically, not lexically, without prompting downgrades', () => {
  for (const [latest, current, expected] of [
    ['v0.2.10', '0.2.9', true], ['v0.10.0', '0.9.9', true],
    ['v1.0.0', '0.99.99', true], ['v0.2.4', '0.2.4', false],
    ['v0.2.3', '0.2.4', false], ['v1.0.0', '2.0.0', false],
  ]) assert.equal(isNewer(latest, current), expected);
  for (const version of ['v0.2.5-beta.1', 'latest', 'v01.2.3', '1.2', '1.2.3/path']) {
    assert.throws(() => isNewer(version, '0.2.3'), /Invalid stable release/);
  }
});

test('checks public stable releases with a timeout and preserves notes as plain text', async () => {
  const { updates, state, release } = service();
  const result = await updates.check({ automatic: true });
  assert.equal(result.status, 'available');
  assert.equal(result.currentVersion, '0.2.3');
  assert.equal(result.release.version, '0.2.4');
  assert.equal(result.release.notes, release.body);
  assert.equal(result.notify, true);
  assert.equal(state.requests[0].url, 'https://api.github.com/repos/apulianas/AMP22/releases/latest');
  assert.ok(state.requests[0].opts.signal instanceof AbortSignal);
  assert.deepEqual(state.opened, [], 'checking never opens a browser or downloads an installer');
  await updates.openDownload();
  assert.deepEqual(state.opened, ['https://github.com/apulianas/AMP22/releases/tag/v0.2.4']);
});

test('Later suppresses automatic prompts only for that version; manual checks and newer releases still notify', async () => {
  const { updates, state, release } = service();
  await updates.check();
  updates.dismiss();
  assert.equal(state.stored.dismissedVersion, '0.2.4');
  assert.equal((await updates.check({ automatic: true })).notify, false);
  assert.equal((await updates.check()).notify, true);
  release.tag_name = 'v0.2.5';
  assert.equal((await updates.check({ automatic: true })).notify, true);
});

test('development builds skip automatic network requests but allow manual checks', async () => {
  const { updates, state } = service({ packaged: false });
  assert.equal((await updates.check({ automatic: true })).status, 'disabled');
  assert.equal(state.requests.length, 0);
  assert.equal((await updates.check()).status, 'available');
});

test('current or newer installations are not offered an update', async () => {
  for (const version of ['0.2.4', '0.2.5']) {
    const { updates } = service({ version });
    const result = await updates.check();
    assert.equal(result.status, 'current');
    assert.equal(result.release, null);
    assert.equal(result.notify, false);
    await assert.rejects(updates.openDownload(), /Check for a newer release/);
  }
});

test('concurrent checks share one network request', async () => {
  let resolve;
  const { updates } = service({ fetch: () => new Promise((done) => { resolve = done; }) });
  const a = updates.check({ automatic: true });
  const b = updates.check();
  resolve({ ok: true, json: async () => ({ tag_name: 'v0.2.4', draft: false, prerelease: false }) });
  const results = await Promise.all([a, b]);
  assert.deepEqual(results[0], results[1]);
  assert.match(results[0].release.notes, /No release notes/);
});

test('network errors, rate limits, and malformed releases are reported and can be retried', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const fetch of [
    async () => { throw new Error('Offline'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } }),
    async () => ({ ok: true, json: async () => ({ tag_name: 'v0.2.5-beta', draft: false, prerelease: true }) }),
    async () => ({ ok: true, json: async () => ({ tag_name: 'malformed', draft: false, prerelease: false }) }),
  ]) {
    const { updates } = service({ fetch });
    const result = await updates.check();
    assert.equal(result.status, 'error');
    assert.ok(result.message);
    assert.equal(result.notify, false);
    updates.fetch = service().updates.fetch;
    assert.equal((await updates.check()).status, 'available');
  }
});

test('opening a failed download page does not dismiss the update', async () => {
  const { updates, state } = service({ openExternal: async () => { throw new Error('Browser unavailable'); } });
  await updates.check();
  await assert.rejects(updates.openDownload(), /Browser unavailable/);
  assert.deepEqual(state.stored, {});
});
