'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function exerciseWindows({ app, win }) {
  const { BrowserWindow, ipcMain } = require('electron');
  const { pathToFileURL } = require('node:url');
  ipcMain.removeHandler('schedule:get');
  ipcMain.handle('schedule:get', () => { throw new Error('Offline window test'); });
  const fixture = path.join(app.getPath('userData'), 'angles.mp4');
  const encoded = spawnSync(require('ffmpeg-static'), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=40',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture,
  ]);
  assert.equal(encoded.status, 0, String(encoded.stderr));
  const js = (source) => win.webContents.executeJavaScript(source, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (check) => {
    const deadline = Date.now() + 5000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for angle window');
      await wait(25);
    }
  };
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await until(() => js(`$('status').textContent.includes('Offline window test')`));
  await js(`(async () => {
    applySettings(A22.settings.DEFAULT_SETTINGS);
    S.settings.speeds = [1, 0.5];
    S.sel.gameId = 'window-test';
    S.film = {url: ${JSON.stringify(pathToFileURL(fixture).href)}};
    S.fps = 30;
    window.originalPlayers = [vidA(), vidB()];
    vidA().src = vidB().src = S.film.url;
    await Promise.all([vidA(), vidB()].map(v => new Promise(resolve =>
      v.addEventListener('loadedmetadata', resolve, {once: true}))));
    setAnalysis({pairs: [
      {sideline: {start: 0, end: 8}, endzone: {start: 20, end: 28}},
      {sideline: {start: 8, end: 18}, endzone: {start: 28, end: 38}}
    ]});
    loadPair(0);
    seekRel(2);
  })()`);
  const settled = () => js(`!vidA().seeking && !vidB().seeking`);
  await until(settled);
  for (const key of ['b', 'a']) {
    await js(`popAngle('${key}')`);
    await until(() => js(`vid${key.toUpperCase()}().ownerDocument.URL.endsWith('angle.html')`));
    await until(settled);
    assert.ok(Math.abs(await js('currentRel()') - 2) < .001, 'detaching preserves the paused frame');
    assert.equal(await js('S.playing'), false);
    assert.equal(await js('vidA() === originalPlayers[0] && vidB() === originalPlayers[1]'), true);
    assert.equal(await js(`$('pop-a').disabled && $('pop-b').disabled`), true);
    assert.equal(await js(`$('fig${key.toUpperCase()}').classList.contains('detached')`), true);
    const child = BrowserWindow.getAllWindows().find((w) => w !== win);
    const childJs = (source) => child.webContents.executeJavaScript(source, true);
    assert.equal(await childJs('typeof require'), 'undefined');
    await childJs(`document.querySelector('[data-action="frameForward"]').click()`);
    await until(settled);
    assert.ok(Math.abs(await js('currentRel()') - (2 + 1 / 30)) < .001);
    await childJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true}))`);
    await until(settled);
    assert.ok(Math.abs(await js('currentRel()') - 2) < .001, 'shortcuts work while the child is focused');
    await childJs(`document.querySelector('[data-action="playPause"]').click()`);
    await wait(600);
    assert.equal(await js('S.playing && !vidA().paused && !vidB().paused'), true);
    assert.ok(await js('currentRel()') > 2.2);
    assert.ok(Math.abs(await js('(vidB().currentTime - vidA().currentTime) - 20')) < .1);
    await js(`runAction('cycleSpeed')`);
    assert.equal(await js('vidA().playbackRate'), .5);
    assert.ok(Math.abs(await js('vidB().playbackRate') - .5) < .07);
    win.minimize();
    const before = await js('currentRel()');
    await wait(600);
    assert.ok(await js('currentRel()') > before + .15, 'playback continues with the main window minimized');
    win.restore();
    await childJs(`document.querySelector('[data-action="playPause"]').click()`);
    await until(settled);
    const offset = await js('offsetFrames(S.curPair)');
    await js('nudge(1)');
    await until(settled);
    assert.ok(Math.abs(await js('vidB().currentTime - vidA().currentTime') - 20 - (offset + 1) / 30) < .001);
    await childJs(`document.querySelector('[data-action="nextPlay"]').click()`);
    await until(settled);
    assert.equal(await js('S.curPair'), 1);
    assert.ok(Math.abs(await js('currentRel()')) < .001);
    await childJs(`document.querySelector('[data-action="prevPlay"]').click()`);
    await until(settled);
    assert.equal(await js('S.curPair'), 0);
    await childJs(`document.getElementById('angle-fullscreen').click()`);
    await until(() => childJs('!!document.fullscreenElement'));
    await childJs(`document.getElementById('angle-fullscreen').click()`);
    await until(() => childJs('!document.fullscreenElement'));
    await js(`S.settings.endOfPlay = 'loop'; seekRel(S.range.len - 0.1); play()`);
    await wait(600);
    assert.ok(await js('currentRel()') < 1, 'end-of-play looping keeps the detached player synced');
    assert.equal(await js('S.playing'), true);
    if (key === 'b') child.close();
    else await js(`$('return-angle').click()`);
    await until(() => js('detachedAngle === null'));
    await until(() => Promise.resolve(child.isDestroyed()));
    assert.equal(await js(`vid${key.toUpperCase()}().ownerDocument === document`), true);
    assert.equal(await js('S.playing'), true, 'docking preserves playback');
    assert.equal(await js(`$('detached-angle').hidden`), true);
    assert.equal(await js(`$('pop-a').disabled || $('pop-b').disabled`), false);
    await js(`pause(); S.speedIdx = 0; S.settings.endOfPlay = 'stop'; seekRel(2)`);
    await until(settled);
  }
  await js(`popAngle('b')`);
  await until(() => js(`vidB().ownerDocument.URL.endsWith('angle.html')`));
  await js('closeFilm()');
  await until(() => js('detachedAngle === null'));
  assert.equal(await js(`!S.playing && $('pop-a').disabled && $('pop-b').disabled && !vidA().hasAttribute('src') && !vidB().hasAttribute('src')`), true);
  console.log('ANGLE WINDOWS PASSED');
  app.exit(0);
}

if (process.versions.electron) {
  module.exports = exerciseWindows;
} else {
  const test = require('node:test');
  const os = require('node:os');
  test('native angle windows preserve player identity, synchronization, controls and docking', {
    skip: !process.env.A22_TEST_WINDOWS,
    timeout: 90000,
  }, () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'a22-angle-windows-'));
    try {
      const result = spawnSync(require('electron'), [path.join(__dirname, '..')], {
        env: { ...process.env, A22_USER_DATA: profile, A22_DEV_SCRIPT: __filename },
        encoding: 'utf8',
        timeout: 80000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /ANGLE WINDOWS PASSED/);
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
