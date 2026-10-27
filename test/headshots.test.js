'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { DataService, PLAYERS_URL } = require('../src/main/data');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const CSV = 'gsis_id,headshot\n00-0039064,"https://static.www.nfl.com/image/upload/f_auto,q_auto/league/flowers"\n00-1,https://example.com/image.png\n';

test('headshots use exact GSIS IDs, normalize the image URL, and cache directory and image downloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-headshots-test-'));
  const calls = [];
  let offline = false;
  const service = new DataService(dir, async (url, options) => {
    calls.push(url);
    assert.ok(options.signal instanceof AbortSignal);
    if (offline) throw new Error('offline');
    return new Response(url === PLAYERS_URL ? CSV : PNG);
  });
  try {
    await Promise.all([service.loadPlayers(), service.loadPlayers()]);
    assert.equal(calls.length, 1);
    const headshot = await service.loadHeadshot('00-0039064');
    assert.equal(headshot.dataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
    assert.equal(calls[1], 'https://static.www.nfl.com/image/upload/f_png,w_256,q_auto/league/flowers');
    await service.loadHeadshot('00-0039064');
    assert.equal(calls.length, 2);
    offline = true;
    await fs.utimes(path.join(dir, 'headshots', '00-0039064.img'), new Date(0), new Date(0));
    const stale = await service.loadHeadshot('00-0039064');
    assert.equal(stale.dataUrl, headshot.dataUrl);
    assert.match(stale.warning, /cached.*offline/);
    await assert.rejects(service.loadHeadshot('missing'), /No headshot/);
    await assert.rejects(service.loadHeadshot('../escape'), /Invalid player ID/);
    await assert.rejects(service.loadHeadshot('00-1'), /Unsupported headshot source/);
    await assert.rejects(service.loadHeadshot('00-0039064', null, { signal: AbortSignal.abort() }), /abort/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('failed player directory loads can be retried and bad images are not retained', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-headshots-test-'));
  let fail = true;
  const service = new DataService(dir, async (url) => {
    if (url === PLAYERS_URL) return new Response(fail ? 'Unavailable' : CSV, { status: fail ? 503 : 200 });
    return new Response('<html>Not an image</html>');
  });
  try {
    await assert.rejects(service.loadHeadshot('00-0039064'), /503/);
    fail = false;
    await assert.rejects(service.loadHeadshot('00-0039064'), /Invalid headshot image/);
    await assert.rejects(fs.stat(path.join(dir, 'headshots', '00-0039064.img')), { code: 'ENOENT' });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
