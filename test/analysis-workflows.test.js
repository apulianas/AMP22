'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function exerciseAnalysis({ app, win }) {
  win.webContents.on('console-message', (event) => console.log('Renderer:', event.message));
  const { ipcMain, dialog } = require('electron');
  const js = async (source) => {
    try { return await win.webContents.executeJavaScript(source, true); }
    catch (error) { throw new Error(`Renderer script failed: ${source}`, { cause: error }); }
  };
  ipcMain.removeHandler('schedule:get');
  ipcMain.handle('schedule:get', () => { throw new Error('Analysis workflow offline boot'); });
  let filmCalls = 0;
  for (const channel of ['film:open', 'film:suggest', 'film:analyze']) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => { filmCalls++; throw new Error('Film access forbidden in analysis workflow'); });
  }
  const games = [
    { gameId: '2024_04_BUF_BAL', season: 2024, week: 4, gameType: 'REG', homeTeam: 'BAL', awayTeam: 'BUF', homeScore: 35, awayScore: 10 },
    { gameId: '2024_05_BAL_CIN', season: 2024, week: 5, gameType: 'REG', homeTeam: 'CIN', awayTeam: 'BAL', homeScore: 38, awayScore: 41 },
  ];
  const P = require('../src/shared/plays');
  const A = require('../src/shared/analysis');
  const players = Object.entries(A.DEFAULT_PACKAGES[0].counts).flatMap(([position, count]) =>
    Array.from({ length: count }, (_n, i) => ({ id: `${position}-${i}`, position, name: `${position} ${i}` })));
  const makePlays = (game) => Array.from({ length: 12 }, (_n, i) => ({
    ...P.normalizePlay({
      game_id: game.gameId, play_id: i + 1, posteam: game.awayTeam === 'BAL' ? 'CIN' : 'BUF', defteam: 'BAL',
      play_type: i % 2 ? 'pass' : 'run', qtr: i < 6 ? 1 : 3, time: '10:00', down: 3, ydstogo: 7,
      yards_gained: i % 2 ? 10 : 4, epa: i % 2 ? 0.5 : -0.5, desc: `Analysis fixture ${i + 1}`,
    }),
    onField: { offense: [], defense: players.map((p, index) => game.week === 5 && index === 0 ? { ...p, id: 'range-only', name: 'Range Only Defender' } : p) }, personnel: { offense: '11' },
    participation: { source: 'NFL Pro', status: 'complete' }, charting: { motion: i % 2 === 0 },
  }));
  let failRange = false;
  let failGame = false;
  const requests = [];
  ipcMain.removeHandler('pbp:get');
  ipcMain.handle('pbp:get', (_e, { gameId, force }) => {
    requests.push({ gameId, force });
    if (failGame) throw new Error('Selected source unavailable');
    if (failRange && gameId === games[1].gameId) throw new Error('Range source unavailable');
    return { plays: makePlays(games.find((g) => g.gameId === gameId)) };
  });
  ipcMain.removeHandler('game:get');
  ipcMain.handle('game:get', () => ({ filmPath: '/unread-film.mp4', filmFormat: 'single' }));
  const waitUntil = async (condition) => {
    for (let i = 0; i < 200; i++) {
      if (await js(condition)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${condition}`);
  };
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await waitUntil(`$('status').textContent.includes('Analysis workflow offline boot')`);
  await js(`(async () => {
    await setWorkspaceMode('analysis', false);
    S.games = ${JSON.stringify(games)};
    S.sel = {season: 2024, team: 'BAL', gameId: '2024_04_BUF_BAL'};
    renderSelectors();
    await loadGame();
  })()`);
  await waitUntil(`document.querySelector('#lab-rows button') !== null`);
  assert.equal(filmCalls, 0);
  assert.equal(await js(`$('viewer').hidden && !$('analysis-lab').hidden`), true);
  assert.match(await js(`$('lab-summary').textContent`), /12/);
  assert.match(await js(`$('lab-rows').textContent`), /Big nickel/);
  assert.equal(await js(`localStorage.getItem('amp22.workspace')`), 'analysis');
  await js(`document.querySelector('#lab-packages [data-remove="0"]').click();
    $('lab-package-name').value = 'My nickel';
    for (const [position, count] of Object.entries(${JSON.stringify(A.DEFAULT_PACKAGES[0].counts)})) $('lab-count-' + position).value = count;
    $('lab-package-form').requestSubmit();`);
  assert.match(await js(`$('lab-rows').textContent`), /My nickel/);
  assert.match(await js(`localStorage.getItem('amp22.analysis.packages')`), /My nickel/);
  await js(`$('lab-count-S').value = '2'; $('lab-package-name').value = 'Invalid'; $('lab-package-form').requestSubmit()`);
  assert.match(await js(`$('lab-package-status').textContent`), /not saved/);
  await js(`$('lab-package-reset').click()`);
  await js(`$('type-chips').querySelector('[data-type="run"]').click()`);
  assert.match(await js(`$('lab-summary').textContent`), /6BAL defense scored snaps/);
  await js(`$('type-chips').querySelector('[data-type="all"]').click();
    $('lab-chart').value = 'heatmap'; $('lab-chart').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-chart-preview').innerHTML`), /11/);
  await js(`$('lab-chart').value = 'halves'; $('lab-chart').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-rows').textContent`), /First half/);
  assert.match(await js(`$('lab-rows').textContent`), /Second half/);
  await js(`document.querySelector('#lab-rows button').click()`);
  assert.equal(await js(`$('lab-evidence').hidden`), false);
  assert.equal(await js(`$('lab-evidence-plays').children.length`), 6);
  await js(`$('lab-scope').value = 'range'; $('lab-from').value = '4'; $('lab-to').value = '5'; $('lab-scope').dispatchEvent(new Event('change'));`);
  await waitUntil(`$('lab-summary').textContent.includes('24BAL defense scored snaps')`);
  assert.match(await js(`$('player-choice').textContent`), /Range Only Defender.*12 plays/);
  assert.match(await js(`$('sel-offense').textContent`), /CIN offense/);
  await js(`document.querySelector('#lab-chart-preview [data-bucket]').dispatchEvent(new MouseEvent('click', {bubbles: true}))`);
  assert.equal(await js(`$('lab-evidence').hidden`), false);
  await js(`setAdvancedChoice('player', 'range-only')`);
  assert.match(await js(`$('lab-summary').textContent`), /12BAL defense scored snaps/);
  await js(`removePlayerFilter('range-only')`);
  assert.equal(filmCalls, 0);
  const folder = app.getPath('userData');
  let destination;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  for (const format of ['svg', 'png', 'csv']) {
    destination = path.join(folder, `analysis.${format}`);
    await js(`$('lab-${format}').click()`);
    await waitUntil(`$('lab-status').textContent.includes('Saved ${format.toUpperCase()}')`);
    const output = fs.readFileSync(destination);
    if (format === 'svg') assert.match(output.toString(), /^<svg/);
    if (format === 'png') assert.equal(output.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    if (format === 'csv') assert.match(output.toString(), /Shared filters/);
  }
  destination = path.join(folder, 'evidence.csv');
  await js(`document.querySelector('#lab-rows button').click(); $('lab-evidence-csv').click()`);
  await waitUntil(`$('lab-status').textContent.includes('evidence plays')`);
  assert.match(fs.readFileSync(destination, 'utf8'), /Analysis fixture/);
  failRange = true;
  await js(`$('lab-reload').click()`);
  await waitUntil(`$('lab-status').textContent.includes('Range source unavailable')`);
  assert.equal(await js(`$('lab-content').hidden`), true, 'failed range never shows a success-shaped partial aggregate');
  failRange = false;
  await js(`$('lab-scope').value = 'game'; $('lab-scope').dispatchEvent(new Event('change'))`);
  await waitUntil(`!$('lab-content').hidden`);
  failGame = true;
  await js(`$('lab-reload').click()`);
  await waitUntil(`$('lab-status').textContent.includes('Selected source unavailable')`);
  await js(`$('type-chips').querySelector('[data-type="run"]').click()`);
  assert.equal(await js(`$('lab-content').hidden`), true, 'filter edits must not resurrect stale selected-game results after a failed reload');
  assert.equal(filmCalls, 0);
  assert.ok(requests.some((r) => r.force === true));
  win.setSize(1100, 800);
  assert.equal(await js(`$('topbar').scrollWidth <= $('topbar').clientWidth`), true, 'workspace toolbar fits the minimum supported window size');
  console.log('ANALYSIS WORKFLOWS PASSED (NO FILM ACCESS)');
  app.exit(0);
}

if (process.versions.electron) module.exports = exerciseAnalysis;
else {
  const test = require('node:test');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  test('native Analysis Lab filters, ranges, evidence, graphics and failure handling without film', {
    skip: !process.env.A22_TEST_ANALYSIS, timeout: 60000,
  }, () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-analysis-workflows-'));
    try {
      const result = spawnSync(require('electron'), ['--no-sandbox', path.join(__dirname, '..')], {
        env: { ...process.env, A22_USER_DATA: profile, A22_DEV_SCRIPT: __filename },
        encoding: 'utf8', timeout: 55000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /ANALYSIS WORKFLOWS PASSED/);
    } finally { fs.rmSync(profile, { recursive: true, force: true }); }
  });
}
