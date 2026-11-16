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
  let fixtureSize = 12;
  const makePlays = (game) => Array.from({ length: fixtureSize }, (_n, i) => ({
    ...P.normalizePlay({
      game_id: game.gameId, play_id: i + 1, posteam: game.awayTeam === 'BAL' ? 'CIN' : 'BUF', defteam: 'BAL',
      play_type: i % 2 ? 'pass' : 'run', qtr: i < 6 ? 1 : 3, time: '10:00', down: 3, ydstogo: 7,
      yards_gained: i % 2 ? 10 : 4, epa: i % 2 ? 0.5 : -0.5, desc: `Analysis fixture ${i + 1}`,
    }),
    onField: { offense: [], defense: players.map((p, index) => game.week === 5 && index === 0 ? { ...p, id: 'range-only', name: 'Range Only Defender' } : p) }, personnel: { offense: '11' },
    participation: { source: 'NFL Pro', status: 'complete' },
    charting: { motion: i % 2 === 0, ...(game.week === 5 ? { pressure: i % 2 === 1 } : {}) },
    chartingSources: { motion: 'FTN', ...(game.week === 5 ? { pressure: 'NFL Pro / NGS' } : {}) },
  })).concat(Array.from({ length: 4 }, (_n, i) => ({
    ...P.normalizePlay({
      game_id: game.gameId, play_id: fixtureSize + i + 1, posteam: 'BAL', defteam: game.homeTeam === 'BAL' ? game.awayTeam : game.homeTeam,
      play_type: i % 2 ? 'pass' : 'run', qtr: 2, time: '10:00', down: 1, ydstogo: 10,
      yards_gained: i % 2 ? 12 : 6, epa: 0.25, desc: `Baltimore offense fixture ${i + 1}`,
    }),
    personnel: { offense: '11' },
  })));
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
  await js('loadSchedule(false)');
  await waitUntil(`$('app-toast').textContent.includes('Analysis workflow offline boot')`);
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
  assert.equal(await js(`$('lab-side').closest('#sidebar') !== null`), true, 'analysis side belongs beside the Film Room filters');
  assert.equal(await js(`$('lab-selection-mode').closest('#topbar') !== null`), true, 'selection mode stays in the persistent toolbar');
  assert.equal(await js(`document.querySelectorAll('#lab-selection-mode').length`), 1);
  assert.equal(await js(`document.querySelectorAll('#lab-side').length`), 1);
  assert.deepEqual(await js(`[...$('lab-side').options].map(option => option.textContent)`), ['Baltimore Ravens defense', 'Baltimore Ravens offense']);
  assert.deepEqual(await js(`S.visible.map(index => S.plays[index].posteam)`), Array(12).fill('BUF'));
  assert.equal(await js(`$('play-list').querySelectorAll('li[data-i]').length`), 12);
  await js(`setWorkspaceMode('film', false)`);
  assert.equal(await js(`$('analysis-perspective').hidden`), true, 'analysis-only control stays hidden in Film Room');
  assert.equal(await js(`getComputedStyle($('lab-selection-controls')).display`), 'none');
  await js(`setWorkspaceMode('analysis', false)`);
  assert.equal(await js(`$('analysis-perspective').hidden`), false);
  assert.notEqual(await js(`getComputedStyle($('lab-selection-controls')).display`), 'none');
  await js(`$('lab-side').value = 'offense'; $('lab-side').dispatchEvent(new Event('change'))`);
  assert.match(await js(`$('lab-summary').textContent`), /4Scored snapsBAL offense/);
  assert.deepEqual(await js(`S.visible.map(index => S.plays[index].posteam)`), Array(4).fill('BAL'));
  assert.deepEqual(await js(`S.visible`), [12, 13, 14, 15], 'sidebar indices stay aligned with the loaded game');
  assert.match(await js(`$('sel-offense').textContent`), /Baltimore Ravens offense/);
  assert.equal(await js(`$('lab-yards-heading').textContent`), 'Yards gained');
  await js(`$('type-chips').querySelector('[data-type="pass"]').click()`);
  assert.equal(await js(`S.visible.length`), 2);
  await js(`$('clear-filters').click()`);
  assert.equal(await js(`$('lab-side').value`), 'offense');
  assert.deepEqual(await js(`S.visible`), [12, 13, 14, 15], 'clearing filters does not broaden the list to the other side');
  await js(`$('lab-side').value = 'defense'; $('lab-side').dispatchEvent(new Event('change'))`);
  assert.deepEqual(await js(`S.visible.map(index => S.plays[index].defteam)`), Array(12).fill('BAL'));
  assert.equal(await js(`$('lab-yards-heading').textContent`), 'Yards allowed');
  assert.match(await js(`$('lab-summary').textContent`), /12/);
  assert.match(await js(`$('lab-rows').textContent`), /Big nickel/);
  assert.doesNotMatch(await js(`$('analysis-lab').textContent`), /small sample|\(small\)/i);
  assert.deepEqual(await js(`[...document.querySelectorAll('#lab-rows tr')].map(row => row.cells[1].textContent)`), ['6', '6']);
  assert.equal(await js(`document.querySelector('#lab-rows tr').cells[3].querySelector('small').textContent`), '6 plays');
  assert.deepEqual(await js(`[...document.querySelectorAll('#lab-rows tr')].map(row => row.querySelector('small').textContent)`),
    ['Run (incl. scrambles)', 'Pass (incl. sacks)']);
  assert.deepEqual(await js(`[...document.querySelectorAll('#lab-rows .lab-split-badge')].map(badge => ({
    label: badge.textContent, color: getComputedStyle(badge).backgroundColor,
    weight: getComputedStyle(badge).fontWeight, transform: getComputedStyle(badge).textTransform,
    rowClass: badge.closest('tr').className
  }))`), [
    { label: 'Run', color: 'rgb(86, 211, 100)', weight: '700', transform: 'uppercase', rowClass: 'lab-row-run' },
    { label: 'Pass', color: 'rgb(121, 192, 255)', weight: '700', transform: 'uppercase', rowClass: 'lab-row-pass' },
  ]);
  assert.notEqual(await js(`getComputedStyle(document.querySelector('#lab-rows .lab-row-run')).backgroundColor`),
    await js(`getComputedStyle(document.querySelector('#lab-rows .lab-row-pass')).backgroundColor`));
  assert.equal(await js(`localStorage.getItem('amp22.workspace')`), 'analysis');
  assert.equal(await js(`$('clear-filters').hidden`), true);
  assert.equal(await js(`$('type-chips').querySelector('[data-type="run"]').textContent`), 'Run (6)');
  await js(`setAdvancedChoice('motion', 'true')`);
  assert.equal(await js(`$('clear-filters').hidden`), false);
  assert.equal(await js(`document.querySelector('[data-choice="motion"] option[value="false"]').textContent`), 'No (6)');
  assert.equal(await js(`$('type-chips').querySelector('[data-type="pass"]').textContent`), 'Pass (0)');
  await js(`$('clear-filters').click()`);
  assert.equal(await js(`$('clear-filters').hidden`), true);
  assert.equal(await js(`document.activeElement.id`), 'search');
  assert.equal(await js(`$('type-chips').querySelector('[data-type="pass"]').textContent`), 'Pass (6)');
  await js(`document.querySelector('#play-list li[data-i="1"] .box').click()`);
  assert.equal(await js(`S.selected.size`), 0, 'browsing a play sets a range anchor without selecting it for analysis');
  assert.equal(await js(`S.multiSelect`), false);
  await js(`document.querySelector('#play-list li[data-i="4"] .box').dispatchEvent(new MouseEvent('click', {bubbles: true, shiftKey: true}))`);
  assert.deepEqual(await js(`[...S.selected]`), [1, 2, 3, 4], 'Shift-click includes the originally clicked play and both endpoints');
  assert.equal(await js(`$('btn-multi-select').getAttribute('aria-pressed')`), 'true');
  assert.equal(await js(`document.querySelector('#play-list li[data-i="1"] .play-check').hidden`), false);
  assert.equal(await js(`$('lab-selection-mode').value`), 'all', 'range selection prompts for a mode instead of silently narrowing analysis');
  assert.match(await js(`$('lab-summary').textContent`), /12Scored snapsBAL defense/);
  assert.equal(await js(`$('lab-selection-controls').classList.contains('selection-pending')`), true);
  assert.match(await js(`$('lab-selection-count').textContent`), /4 selected; selection not applied/);
  const toolbarTop = await js(`$('lab-selection-mode').getBoundingClientRect().top`);
  await js(`$('lab-definitions').open = true`);
  await js(`$('analysis-lab').scrollTop = 400`);
  assert.ok(await js(`$('analysis-lab').scrollTop > 0`), 'analysis results remain scrollable');
  assert.equal(await js(`$('lab-selection-mode').getBoundingClientRect().top`), toolbarTop, 'the mode does not scroll away with results');
  await js(`$('lab-definitions').open = false`);
  await js(`$('lab-selection-mode').value = 'include'; $('lab-selection-mode').dispatchEvent(new Event('change'))`);
  assert.match(await js(`$('lab-summary').textContent`), /4Scored snapsBAL defense/);
  assert.equal(await js(`$('lab-selection-controls').classList.contains('selection-pending')`), false);
  await js(`$('lab-selection-mode').value = 'exclude'; $('lab-selection-mode').dispatchEvent(new Event('change'))`);
  assert.match(await js(`$('lab-summary').textContent`), /8Scored snapsBAL defense/);
  await js(`$('clear-filters').click(); $('btn-clear-selection').click(); $('analysis-lab').scrollTop = 0`);
  assert.equal(await js(`$('lab-selection-controls').classList.contains('selection-pending')`), false);
  await js(`$('type-chips').querySelector('[data-type="run"]').click();
    document.querySelector('#play-list li[data-i="4"] .box').click();
    document.querySelector('#play-list li[data-i="0"] .box').dispatchEvent(new MouseEvent('click', {bubbles: true, shiftKey: true}));`);
  assert.deepEqual(await js(`[...S.selected]`), [0, 2, 4], 'reverse ranges include only visible plays, not filtered-out passes');
  await js(`$('btn-clear-selection').click(); $('clear-filters').click()`);
  await js(`$('lab-play-selection').open = true;
    document.querySelector('#lab-selection-plays [data-selection="0"]').click();
    document.querySelector('#lab-selection-plays [data-selection="2"]').dispatchEvent(new MouseEvent('click', {bubbles: true, shiftKey: true}));`);
  assert.equal(await js(`$('lab-selection-controls').classList.contains('selection-pending')`), true, 'the full-scope picker also cues the selection mode');
  await js(`$('lab-selection-mode').value = 'include'; $('lab-selection-mode').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-summary').textContent`), /3Scored snapsBAL defense/);
  assert.equal(await js(`S.selected.size`), 3, 'range selection synchronizes sidebar selection');
  assert.equal(await js(`$('type-chips').querySelector('[data-type="all"]').textContent`), 'All (3)');
  assert.match(await js(`$('lab-coverage').textContent`), /Only selected plays; 3 selected/);
  await js(`document.querySelector('#lab-selection-plays [data-selection="1"]').click()`);
  assert.match(await js(`$('lab-summary').textContent`), /2Scored snapsBAL defense/);
  assert.equal(await js(`document.querySelector('#lab-rows td:nth-child(4)').textContent`), '82 plays');
  await js(`$('lab-selection-mode').value = 'exclude'; $('lab-selection-mode').dispatchEvent(new Event('change'))`);
  assert.match(await js(`$('lab-summary').textContent`), /10Scored snapsBAL defense/);
  assert.equal(await js(`$('lab-selection-plays').children.length`), 12, 'excluded plays remain in the picker');
  await js(`document.querySelector('#lab-selection-plays [data-selection="0"]').click()`);
  assert.match(await js(`$('lab-summary').textContent`), /11Scored snapsBAL defense/);
  await js(`$('lab-clear-selection').click(); $('lab-selection-mode').value = 'include'; $('lab-selection-mode').dispatchEvent(new Event('change'))`);
  assert.match(await js(`$('lab-summary').textContent`), /0Scored snapsBAL defense/);
  assert.equal(await js(`$('lab-csv').disabled`), true, 'empty selection never falls back to all plays');
  assert.equal(await js(`$('clear-filters').hidden`), false, 'selection mode alone is an active filter');
  await js(`$('clear-filters').click()`);
  assert.equal(await js(`$('lab-selection-mode').value`), 'all');
  await js(`$('btn-multi-select').click();
    document.querySelector('#play-list li[data-i="0"] .play-check').click();
    document.querySelector('#play-list li[data-i="1"] .play-check').click();
    $('lab-selection-mode').value = 'include'; $('lab-selection-mode').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-summary').textContent`), /2Scored snapsBAL defense/);
  await js(`document.querySelector('#play-list li[data-i="0"] .play-check').click()`);
  assert.match(await js(`$('lab-summary').textContent`), /1Scored snapsBAL defense/);
  await js(`$('btn-clear-selection').click()`);
  assert.match(await js(`$('lab-summary').textContent`), /0Scored snapsBAL defense/);
  await js(`$('clear-filters').click()`);
  await js(`document.querySelector('#lab-packages [data-remove="0"]').click();
    $('lab-package-name').value = 'My nickel';
    for (const [position, count] of Object.entries(${JSON.stringify(A.DEFAULT_PACKAGES[0].counts)})) $('lab-count-' + position).value = count;
    $('lab-package-form').requestSubmit();`);
  assert.match(await js(`$('lab-rows').textContent`), /My nickel/);
  assert.doesNotMatch(await js(`$('lab-rows').textContent`), /My nickel\*/);
  assert.equal(await js(`document.querySelectorAll('#lab-chart-preview .lab-chart-package-note').length`), 1);
  assert.equal(await js(`document.querySelector('#lab-chart-preview .lab-chart-package-note').textContent`),
    'Packages estimated from listed positions');
  assert.match(await js(`localStorage.getItem('amp22.analysis.packages')`), /My nickel/);
  const packageFolder = app.getPath('userData');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(packageFolder, 'custom-evidence.csv') });
  await js(`document.querySelector('#lab-rows button').click(); $('lab-evidence-csv').click()`);
  await waitUntil(`$('lab-status').textContent.includes('evidence plays')`);
  const customRows = require('../src/shared/csv').parseCSV(fs.readFileSync(path.join(packageFolder, 'custom-evidence.csv'), 'utf8')).rows;
  assert.ok(customRows.every(row => row['Defensive package'] === 'My nickel*'));
  assert.ok(customRows.every(row => row['Inferred defensive package'] === 'My nickel*'));
  await js(`$('lab-evidence-close').click()`);
  await js(`$('lab-count-S').value = '2'; $('lab-package-name').value = 'Invalid'; $('lab-package-form').requestSubmit()`);
  assert.match(await js(`$('lab-package-status').textContent`), /not saved/);
  await js(`$('lab-package-reset').click()`);
  await js(`$('type-chips').querySelector('[data-type="run"]').click()`);
  assert.match(await js(`$('lab-summary').textContent`), /6Scored snapsBAL defense/);
  await js(`$('type-chips').querySelector('[data-type="all"]').click();
    $('lab-chart').value = 'heatmap'; $('lab-chart').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-chart-preview').innerHTML`), /11/);
  assert.doesNotMatch(await js(`$('lab-chart-preview').textContent`), /nickel\*|11\*/i);
  assert.equal(await js(`document.querySelectorAll('#lab-rows .lab-split-badge').length`), 0, 'non-run/pass splits do not receive play-type badges');
  await js(`$('lab-chart').value = 'halves'; $('lab-chart').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-rows').textContent`), /First half/);
  assert.match(await js(`$('lab-rows').textContent`), /Second half/);
  await js(`document.querySelector('#lab-rows button').click()`);
  assert.equal(await js(`$('lab-evidence').hidden`), false);
  assert.equal(await js(`document.querySelector('#lab-rows tr').classList.contains('selected')`), true);
  assert.equal(await js(`$('lab-evidence-plays').children.length`), 6);
  await js(`$('lab-scope').value = 'range'; $('lab-from').value = '4'; $('lab-to').value = '5'; $('lab-scope').dispatchEvent(new Event('change'));`);
  await waitUntil(`$('lab-summary').textContent.includes('24Scored snapsBAL defense')`);
  assert.equal(await js(`$('type-chips').querySelector('[data-type="all"]').textContent`), 'All (24)');
  assert.equal(await js(`S.visible.length`), 12, 'range counts span all games while the sidebar stays on the selected game');
  assert.match(await js(`$('player-choice').textContent`), /Range Only Defender.*12 plays/);
  assert.match(await js(`$('sel-offense').textContent`), /Cincinnati Bengals offense/);
  assert.match(await js(`$('lab-coverage').textContent`), /NFL Pro \/ NGS: 12 snaps/);
  await js(`document.querySelector('#lab-selection-plays [data-selection="0"]').click();
    document.querySelector('#lab-selection-plays [data-selection="12"]').click();
    $('lab-selection-mode').value = 'include'; $('lab-selection-mode').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-summary').textContent`), /2Scored snapsBAL defense/);
  assert.equal(await js(`S.selected.size`), 1, 'same play ID from another game is not confused with selected-game indices');
  await js(`$('lab-reload').click()`);
  await waitUntil(`$('lab-summary').textContent.includes('2Scored snapsBAL defense') && !$('lab-content').hidden`);
  assert.match(await js(`$('lab-selection-count').textContent`), /2 selected/);
  await js(`setAdvancedChoice('motion', 'false')`);
  assert.match(await js(`$('lab-summary').textContent`), /0Scored snapsBAL defense/);
  await js(`$('lab-selection-show').value = 'selected'; $('lab-selection-show').dispatchEvent(new Event('change'))`);
  assert.equal(await js(`$('lab-selection-plays').children.length`), 2, 'hidden selected plays can still be removed');
  await js(`document.querySelector('#lab-selection-plays [data-selection="1"]').click()`);
  assert.match(await js(`$('lab-selection-count').textContent`), /1 selected/);
  await js(`$('clear-filters').click(); $('lab-clear-selection').click();
    $('lab-selection-show').value = 'filtered'; $('lab-selection-show').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-summary').textContent`), /24Scored snapsBAL defense/);
  await js(`S.settings.filterPresets = [PRESETS.capture('Range pressure', {
    ...PRESETS.emptyFilter(), choices: {player: ['range-only'], pressure: 'false'}
  }, 'BAL', 'BUF', {'range-only': 'Range Only Defender'})];
  chooseFilterPreset('Range pressure');`);
  assert.match(await js(`$('lab-summary').textContent`), /6Scored snapsBAL defense/);
  assert.doesNotMatch(await js(`$('filter-data-warning').textContent`), /No matching data/);
  await js(`setWorkspaceMode('analysis')`);
  await waitUntil(`$('lab-summary').textContent.includes('6Scored snapsBAL defense')`);
  assert.equal(await js(`S.appliedPreset.name`), 'Range pressure', 'workspace reload retains applied presets');
  await js(`S.appliedPreset = null; S.filter = PRESETS.emptyFilter(); syncFilterControls(); renderAdvancedFilters(); renderList()`);
  await js(`document.querySelector('#lab-chart-preview [data-bucket]').dispatchEvent(new MouseEvent('click', {bubbles: true}))`);
  assert.equal(await js(`$('lab-evidence').hidden`), false);
  await js(`setAdvancedChoice('player', 'range-only')`);
  assert.match(await js(`$('lab-summary').textContent`), /12Scored snapsBAL defense/);
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
    if (format === 'csv') {
      assert.match(output.toString(), /Shared filters/);
      assert.match(output.toString(), /NFL Pro \/ NGS: 12 snaps/);
    }
    await js(`document.querySelector('#lab-selection-plays [data-selection="0"]').click();
      document.querySelector('#lab-selection-plays [data-selection="12"]').click();
      $('lab-selection-mode').value = 'include'; $('lab-selection-mode').dispatchEvent(new Event('change'));`);
    destination = path.join(folder, 'selected-summary.csv');
    await js(`$('lab-csv').click()`);
    await waitUntil(`$('lab-status').textContent.includes('Saved CSV')`);
    const selectedCsv = fs.readFileSync(destination, 'utf8');
    assert.match(selectedCsv, /Only selected plays; 2 selected/);
    assert.match(selectedCsv, /2024_04_BUF_BAL\/1/);
    assert.match(selectedCsv, /2024_05_BAL_CIN\/1/);
    assert.match(selectedCsv, /Cohort: 2 scored snaps/);
    destination = path.join(folder, 'selected.svg');
    await js(`$('lab-svg').click()`);
    await waitUntil(`$('lab-status').textContent.includes('Saved SVG')`);
    assert.match(fs.readFileSync(destination, 'utf8'), /Only selected plays; 2 selected/);
    await js(`$('clear-filters').click(); $('lab-clear-selection').click()`);
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
  await js(`applySettings({...S.settings, textScale: 1.2})`);
  assert.equal(await js(`$('topbar').scrollWidth <= $('topbar').clientWidth`), true, 'workspace toolbar fits the minimum supported window size');
  assert.equal(await js(`$('lab-selection-controls').scrollWidth <= $('lab-selection-controls').clientWidth`), true, 'selection controls fit with enlarged text');
  assert.equal(await js(`(() => {
    const main = document.querySelector('main').getBoundingClientRect();
    const mode = $('lab-selection-mode').getBoundingClientRect();
    const clear = $('lab-clear-selection').getBoundingClientRect();
    return main.top === $('topbar').getBoundingClientRect().bottom && main.bottom <= innerHeight &&
      mode.top >= 0 && mode.bottom < main.top && mode.right <= innerWidth && clear.right <= innerWidth;
  })()`), true, 'wrapped toolbar remains visible without clipping the workspace');
  failGame = false;
  await js(`$('lab-scope').value = 'game'; $('lab-scope').dispatchEvent(new Event('change'))`);
  await waitUntil(`!$('lab-content').hidden && $('lab-chart-preview').querySelector('svg')`);
  await js(`$('lab-data-quality').open = false; $('lab-play-selection').open = false; $('lab-definitions').open = false`);
  await waitUntil(`Number(document.querySelector('#lab-chart-preview .lab-chart-package').getAttribute('font-size')) >= 21`);
  const controls = await js(`['scope','group','split','chart','metric','ai-open'].map(id => {
    const rect = $('lab-' + id).getBoundingClientRect();
    return {left:rect.left, bottom:rect.bottom, width:rect.width};
  })`);
  assert.equal(controls[0].left, controls[3].left, 'scope and graphic controls share a column');
  assert.equal(controls[1].left, controls[4].left, 'group and metric controls share a column');
  assert.equal(controls[0].width, controls[3].width, 'aligned dropdowns have equal widths');
  assert.equal(controls[3].bottom, controls[4].bottom);
  assert.equal(controls[4].bottom, controls[5].bottom, 'actions align with the dropdown baseline');
  assert.equal(await js(`$('lab-toolbar').scrollWidth <= $('lab-toolbar').clientWidth`), true);
  assert.ok(await js(`(() => {
    const label = document.querySelector('#lab-chart-preview .lab-chart-package');
    return parseFloat(getComputedStyle(label).fontSize) * label.getScreenCTM().a;
  })()`) >= 21, 'package names remain at least 21 screen pixels with enlarged text, not scaled down with the chart');
  const barLabels = await js(`Array.from(document.querySelectorAll('#lab-chart-preview [data-bucket]')).map(row => {
    const bar = row.querySelector('rect').getBoundingClientRect();
    const count = row.querySelector('.lab-chart-sample').getBoundingClientRect();
    const value = row.querySelector('.lab-chart-value').getBoundingClientRect();
    const center = rect => rect.top + rect.height / 2;
    return {
      separated: bar.right + 8 <= count.left && count.right + 8 <= value.left,
      centered: Math.abs(center(count) - center(bar)) < 3 && Math.abs(center(value) - center(bar)) < 3,
      contained: value.right <= row.closest('svg').getBoundingClientRect().right,
    };
  })`);
  assert.ok(barLabels.length && barLabels.every(row => row.separated && row.centered && row.contained),
    `play counts sit left of values on the same bar-centered line at laptop size with enlarged text: ${JSON.stringify(barLabels)}`);
  const laptopLayout = await js(`(() => {
    const summary = $('lab-summary').getBoundingClientRect();
    const chart = $('lab-chart-preview').getBoundingClientRect();
    return {
      optionalClosed: !$('lab-data-quality').open && !$('lab-play-selection').open && !$('lab-definitions').open,
      summary: { top: summary.top, bottom: summary.bottom },
      chart: { top: chart.top, bottom: chart.bottom },
      viewport: innerHeight,
    };
  })()`);
  assert.ok(laptopLayout.optionalClosed && laptopLayout.summary.top >= 0 &&
    laptopLayout.summary.bottom < laptopLayout.viewport && laptopLayout.chart.top >= 0 &&
    laptopLayout.chart.bottom <= laptopLayout.viewport,
  `summary and a useful chart fit above the fold at 1100x800 with optional sections collapsed: ${JSON.stringify(laptopLayout)}`);
  fixtureSize = 240;
  await js(`$('clear-filters').click(); $('lab-reload').click()`);
  await waitUntil(`$('lab-summary').textContent.includes('240Scored snapsBAL defense') && !$('lab-content').hidden`);
  assert.equal(await js(`$('lab-selection-plays').children.length`), 200);
  assert.equal(await js(`$('lab-selection-more').hidden`), false);
  await js(`$('lab-select-filtered').click();
    $('lab-selection-mode').value = 'include'; $('lab-selection-mode').dispatchEvent(new Event('change'));`);
  assert.match(await js(`$('lab-summary').textContent`), /240Scored snapsBAL defense/);
  await js(`$('lab-selection-more').click()`);
  assert.equal(await js(`$('lab-selection-plays').children.length`), 240);
  await js(`document.querySelector('#lab-selection-plays [data-selection="230"]').click()`);
  assert.match(await js(`$('lab-summary').textContent`), /239Scored snapsBAL defense/);
  await js(`$('lab-scope').value = 'range'; $('lab-scope').dispatchEvent(new Event('change'))`);
  await waitUntil(`$('lab-summary').textContent.includes('480Scored snapsBAL defense') && !$('lab-content').hidden`);
  assert.equal(await js(`$('lab-selection-mode').value`), 'all');
  assert.match(await js(`$('lab-selection-count').textContent`), /All filtered plays included/);
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
        env: { ...process.env, A22_HEADLESS: process.env.A22_HEADLESS || '1', A22_USER_DATA: profile, A22_DEV_SCRIPT: __filename },
        encoding: 'utf8', timeout: 55000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /ANALYSIS WORKFLOWS PASSED/);
    } finally { fs.rmSync(profile, { recursive: true, force: true }); }
  });
}
