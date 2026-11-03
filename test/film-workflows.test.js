'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function exerciseWorkflows({ app, win }) {
  const { dialog, ipcMain, BrowserWindow } = require('electron');
  const { pathToFileURL } = require('node:url');
  const { probe } = require('../src/main/media');
  const { parseCSV } = require('../src/shared/csv');
  const root = app.getPath('userData');
  ipcMain.removeHandler('schedule:get');
  ipcMain.handle('schedule:get', () => { throw new Error('Offline workflow test'); });
  const sources = {};
  for (const [role, color, fps] of [['offense', 'red', 30], ['defense', 'blue', 24], ['special', 'green', 60]]) {
    const file = path.join(root, `${role}.mp4`);
    const result = spawnSync(require('ffmpeg-static'), [
      '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=320x180:r=${fps}:d=4`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file,
    ]);
    assert.equal(result.status, 0, String(result.stderr));
    sources[role] = file;
  }
  ipcMain.removeHandler('film:open');
  ipcMain.handle('film:open', async (_e, file) => ({
    path: file, url: pathToFileURL(file).href, info: await probe(file),
    analysis: { pairs: [{ sideline: { start: 0, end: 2 }, endzone: { start: 2, end: 4 } }] },
  }));
  const js = (source) => win.webContents.executeJavaScript(source, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (source) => {
    for (let i = 0; i < 200; i++) {
      if (await js(source)) return;
      await wait(25);
    }
    throw new Error(`Timed out: ${source}`);
  };
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await until(`$('status').textContent.includes('Offline workflow test')`);
  await js(`(async () => {
    applySettings({...A22.settings.DEFAULT_SETTINGS, autoAnalyze: false});
    S.sel = {gameId: 'workflow-test', team: 'BAL'};
    S.game = {homeTeam: 'BAL', awayTeam: 'BUF', season: 2024, week: 4};
    S.gameData = await window.api.saveGame(S.sel.gameId, {
      filmFormat: 'split', splitFilmPaths: {BAL: ${JSON.stringify(sources)}}
    });
    S.plays = [
      {play_id: 1, posteam: 'BAL', defteam: 'BUF', play_type: 'run', rush: 1, yards_gained: 4, rusher_player_name: 'Runner'},
      {play_id: 2, posteam: 'BUF', defteam: 'BAL', play_type: 'pass', pass: 1, complete_pass: 1, yards_gained: 9, receiver_player_name: 'Receiver'},
      {play_id: 3, posteam: 'BAL', defteam: 'BUF', play_type: 'punt', punter_player_name: 'Punter'}
    ].map((row, i) => P.normalizePlay({qtr: 1, time: '12:0' + i, yrdln: 'BAL 20', desc: 'Fixture play ' + (i + 1), ...row}));
    S.plays[1].airYards = 0;
    S.plays[1].charting = {coverage: 'Cover 3', motion: false};
    derivePlays();
    await openSplitFilms();
  })()`);
  const settled = 'vidA().readyState > 0 && vidB().readyState > 0 && !vidA().seeking && !vidB().seeking';
  for (const [i, role, fps] of [[0, 'offense', 30], [1, 'defense', 24], [2, 'special', 60], [0, 'offense', 30]]) {
    await js(`selectPlay(${i}, {autoplay: false})`);
    await until(settled);
    assert.equal(await js('vidA().src'), pathToFileURL(sources[role]).href);
    assert.equal(await js('vidB().src'), pathToFileURL(sources[role]).href);
    assert.equal(await js('S.fps'), fps);
    assert.ok(Math.abs(await js('vidA().currentTime - S.range.aStart')) < 0.001);
    assert.ok(Math.abs(await js('vidB().currentTime - S.range.bStart')) < 0.001);
  }
  await js(`popAngle('b')`);
  await until(`vidB().ownerDocument.URL.endsWith('angle.html')`);
  await js(`selectPlay(1, {autoplay: false})`);
  await until(settled);
  assert.equal(await js('vidB().src'), pathToFileURL(sources.defense).href);
  await js('dockAngle()');
  await until('detachedAngle === null');
  await js(`$('btn-settings').click()`);
  assert.equal(await js(`$('set-report-format').value`), 'csv');
  assert.equal(await js(`$('set-report-advanced').checked`), false);
  await js(`
    $('set-export-trim').value = '0.25';
    $('set-overlay-seconds').value = '1.75';
    $('set-report-format').value = 'pdf';
    $('set-report-advanced').checked = true;
    document.querySelectorAll('#set-report-fields input').forEach(input => {input.checked = ['set-report-airYards', 'set-report-coverage', 'set-report-motion'].includes(input.id)});
    $('set-save').click();
  `);
  await until(`S.settings.playReport.format === 'pdf' && $('settings').hidden`);
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  assert.deepEqual(saved.playReport, { format: 'pdf', includeAdvanced: true, fields: ['airYards', 'motion', 'coverage'] });
  assert.equal(saved.exportTrim, 0.25);
  assert.equal(saved.overlaySeconds, 1.75);
  await js(`S.selected = new Set([2, 0, 1]); updateSelection(); $('btn-share').click(); $('share-clean').checked = true;`);
  assert.equal(await js(`$('share-trim').value`), '0.25');
  assert.equal(await js(`$('share-overlay-seconds').value`), '1.75');
  await until(`!$('share-preview-a').hidden`);
  assert.match(await js(`$('share-preview-a').src`), /^data:image\/jpeg;base64,/);
  assert.equal(await js(`$('share-preview-figure-a').hidden`), false);
  assert.equal(await js(`$('share-preview-figure-b').hidden`), true);
  assert.equal(await js(`getComputedStyle($('share-preview-figure-b')).display`), 'none');
  assert.ok(await js(`Math.abs($('share-preview-figure-a').getBoundingClientRect().width - $('share-preview-figure-a').parentElement.getBoundingClientRect().width) < 1`));
  for (const [mode, a, b] of [
    ['endzone', false, true], ['both', true, true],
    ['sideline-first', true, true], ['endzone-first', true, true], ['sideline', true, false],
  ]) {
    await js(`$('share-angle').value = '${mode}'; $('share-angle').dispatchEvent(new Event('change'))`);
    assert.equal(await js(`$('share-preview-figure-a').hidden`), !a, mode);
    assert.equal(await js(`$('share-preview-figure-b').hidden`), !b, mode);
    await until(`${a ? "!$('share-preview-a').hidden" : "$('share-preview-a').hidden"} && ${b ? "!$('share-preview-b').hidden" : "$('share-preview-b').hidden"}`);
    if (b) assert.match(await js(`$('share-preview-b').src`), /^data:image\/jpeg;base64,/);
  }
  await js(`$('share-trim').value = '0.5'; $('share-trim').dispatchEvent(new Event('input'))`);
  await until(`!$('share-preview-a').hidden`);
  assert.equal(await js(`S.exportDraft.clips[0].trim`), 0.5);
  assert.ok(Math.abs(await js(`trimmedExportClips()[0].aStart - S.exportDraft.clips[0].aStart`) - 0.5) < 1e-9);
  assert.equal(await js(`$('share-report-format').value`), 'pdf');
  assert.equal(await js(`$('share-report-advanced').checked`), true);

  let destination;
  let replace = 0;
  let prompts = 0;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  dialog.showMessageBox = async () => { prompts++; return { response: replace }; };
  for (const format of ['csv', 'txt', 'pdf', 'none']) {
    destination = path.join(root, `export-${format}.mp4`);
    await js(`$('share-report-format').value = '${format}'; $('share-report-advanced').checked = ${format !== 'csv'}; exportSelection();`);
    assert.equal(await js(`$('share-status').classList.contains('error')`), false, await js(`$('share-status').textContent`));
    assert.equal((await probe(destination)).width, 1920);
    const sidecar = path.join(root, `export-${format}-plays.${format}`);
    if (format === 'none') {
      assert.equal(fs.existsSync(sidecar), false);
    } else {
      const content = fs.readFileSync(sidecar);
      if (format === 'csv') {
        const { rows, header } = parseCSV(content.toString());
        assert.deepEqual(rows.map((p) => p['Game play ID']), ['1', '2', '3']);
        assert.equal(header.includes('Air yards'), false);
      } else if (format === 'txt') {
        const text = content.toString();
        assert.ok(text.indexOf('Fixture play 1') < text.indexOf('Fixture play 2'));
        assert.ok(text.indexOf('Fixture play 2') < text.indexOf('Fixture play 3'));
        assert.match(text, /Coverage: Cover 3/);
        assert.match(text, /Motion: No/);
      } else {
        assert.equal(content.subarray(0, 5).toString(), '%PDF-');
        assert.ok(content.length > 5000);
        assert.match(content.toString('latin1'), /\/Type\s*\/Page\b/);
        assert.equal(BrowserWindow.getAllWindows().length, 1, 'PDF renderer is destroyed');
      }
    }
  }
  destination = path.join(root, 'export-csv.mp4');
  const before = fs.readFileSync(destination);
  await js(`$('share-report-format').value = 'csv'; exportSelection();`);
  assert.equal(prompts, 1);
  assert.match(await js(`$('share-status').textContent`), /cancelled/i);
  assert.deepEqual(fs.readFileSync(destination), before);
  for (const mode of ['sideline-first', 'endzone-first']) {
    destination = path.join(root, `${mode}.mp4`);
    await js(`$('share-angle').value = '${mode}'; exportSelection();`);
    assert.equal(await js(`$('share-status').classList.contains('error')`), false, await js(`$('share-status').textContent`));
    const { rows } = parseCSV(fs.readFileSync(path.join(root, `${mode}-plays.csv`), 'utf8'));
    assert.deepEqual(rows.map((p) => p['Game play ID']), ['1', '2', '3', '1', '2', '3']);
  }
  destination = path.join(root, 'partial.mp4');
  fs.mkdirSync(path.join(root, 'partial-plays.csv'));
  replace = 1;
  await js('exportSelection()');
  assert.equal(fs.existsSync(destination), true);
  assert.equal(await js(`$('share-status').classList.contains('error')`), true);
  assert.match(await js(`$('share-status').textContent`), /Video saved.*breakdown could not be saved/);
  assert.ok(!fs.readdirSync(root).some((file) => file.endsWith('.tmp')));
  console.log('FILM WORKFLOWS PASSED');
  app.exit(0);
}

if (process.versions.electron) {
  module.exports = exerciseWorkflows;
} else {
  const test = require('node:test');
  const os = require('node:os');
  test('native split playback, saved report settings, all report formats, and partial failures', {
    skip: !process.env.A22_TEST_WORKFLOWS,
    timeout: 90000,
  }, () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-film-workflows-'));
    try {
      const result = spawnSync(require('electron'), ['--no-sandbox', path.join(__dirname, '..')], {
        env: { ...process.env, A22_USER_DATA: profile, A22_DEV_SCRIPT: __filename },
        encoding: 'utf8', timeout: 80000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /FILM WORKFLOWS PASSED/);
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
