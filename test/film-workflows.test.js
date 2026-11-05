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
  const { printPdf } = require('../src/main/reports');
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
  assert.equal(await js(`getComputedStyle(document.querySelector('#topbar .brand')).backgroundColor`), 'rgba(0, 0, 0, 0)');
  assert.match(await js(`getComputedStyle(document.querySelector('.brand-amp')).maskImage`), /amp\.svg/);
  assert.match(await js(`getComputedStyle(document.querySelector('.brand-amp')).backgroundImage`), /linear-gradient/);
  assert.equal(await js(`getComputedStyle(document.querySelector('.brand-number')).backgroundClip`), 'text');
  assert.match(await js(`getComputedStyle(document.querySelector('.brand-number')).backgroundImage`), /linear-gradient/);
  assert.equal(await js(`(() => {
    const style = getComputedStyle(document.querySelector('.brand-number'));
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = style.font;
    ctx.letterSpacing = style.letterSpacing;
    const ink = ctx.measureText('22');
    return Number.parseFloat(style.paddingRight) >= Math.max(0, ink.actualBoundingBoxRight - ink.width) &&
      Number.parseFloat(style.paddingLeft) >= Math.max(0, ink.actualBoundingBoxLeft);
  })()`), true, 'gradient text has room for the italic glyph overhang');
  assert.equal(await js(`$('film-setup').hidden`), false);
  assert.equal(await js(`$('btn-film').closest('#videos') !== null`), true);
  assert.equal(await js(`document.getElementById('filmbar') === null`), true);
  assert.equal(await js(`$('sidebar').getBoundingClientRect().top === $('topbar').getBoundingClientRect().bottom`), true);
  assert.equal(await js(`(() => {
    const button = $('btn-multi-select').getBoundingClientRect();
    const items = [...document.querySelectorAll('.legend > span')].map(el => el.getBoundingClientRect());
    const footer = document.querySelector('.filter-footer').getBoundingClientRect();
    return items.every(r => r.top >= button.top && r.bottom <= button.bottom && r.right < button.left) &&
      button.right <= footer.right && footer.width >= document.querySelector('.filter-footer').scrollWidth;
  })()`), true, 'Multi-select and all legend labels fit on one line');
  assert.equal(await js(`getComputedStyle($('selection-bar')).display`), 'none');
  await js(`(async () => {
    applySettings({...A22.settings.DEFAULT_SETTINGS, autoAnalyze: false});
    S.sel = {gameId: 'workflow-test', team: 'BAL'};
    S.game = {homeTeam: 'BAL', awayTeam: 'BUF', season: 2024, week: 4};
    S.gameData = await window.api.saveGame(S.sel.gameId, {
      filmFormat: 'split', splitFilmPaths: {BAL: ${JSON.stringify(sources)}}
    });
    renderFilmControls();
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
  assert.equal(await js(`$('film-setup').hidden`), true);
  assert.equal(await js(`$('film-setup-toggle').hidden`), false);
  assert.equal(await js(`(() => {
    const setup = $('film-setup-toggle').getBoundingClientRect();
    return [...document.querySelectorAll('.pop-angle, .angle figcaption')].every(el => {
      const r = el.getBoundingClientRect();
      return setup.right <= r.left || setup.left >= r.right || setup.bottom <= r.top || setup.top >= r.bottom;
    });
  })()`), true, 'Film setup does not cover camera labels or pop-out controls');
  await js(`$('film-setup-toggle').click()`);
  assert.equal(await js(`$('film-setup').hidden`), false);
  assert.equal(await js(`document.activeElement.id`), 'film-format');
  assert.equal(await js(`$('btn-defense-film').hidden || $('btn-special-film').hidden`), false);
  let pickerCalls = 0;
  let pickerOpened;
  const picking = new Promise((resolve) => { pickerOpened = resolve; });
  dialog.showOpenDialog = async () => {
    pickerCalls++;
    pickerOpened();
    return { canceled: true, filePaths: [] };
  };
  await js(`$('btn-defense-film').click()`);
  await picking;
  assert.equal(pickerCalls, 1);
  assert.equal(await js(`S.splitFilms.defense.path`), sources.defense);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sources.offense] });
  const previousRevision = await js('S.filmRevision');
  await js(`$('btn-film').click()`);
  await until(`S.filmRevision > ${previousRevision} && !!S.splitFilms.special && $('film-setup').hidden`);
  await js(`$('film-setup-toggle').click(); $('film-setup-close').click()`);
  assert.equal(await js(`$('film-setup').hidden`), true);
  assert.equal(await js(`document.activeElement.id`), 'film-setup-toggle');
  await js(`$('btn-multi-select').click()`);
  assert.equal(await js(`$('btn-multi-select').getAttribute('aria-pressed')`), 'true');
  assert.equal(await js(`$('selection-bar').hidden`), false);
  assert.equal(await js(`$('btn-clear-selection').hidden`), false);
  await js(`$('btn-multi-select').click()`);
  assert.equal(await js(`$('btn-multi-select').getAttribute('aria-pressed')`), 'false');
  assert.equal(await js(`getComputedStyle($('selection-bar')).display`), 'none');
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

  await js(`$('share-clean').checked = false; $('share-clean').dispatchEvent(new Event('change'));`);
  await until(`!$('share-position-preview').hidden && positionHeadshots !== null`);
  assert.equal(await js(`$('share-theme').value`), 'auto');
  assert.deepEqual(await js(`A22.overlay.theme(currentOverlayAppearance())`), require('../src/shared/overlay').teamTheme('BAL'));
  await js(`$('share-theme').value = 'team-CIN'; $('share-theme').dispatchEvent(new Event('change'))`);
  assert.deepEqual(await js(`A22.overlay.theme(currentOverlayAppearance())`), require('../src/shared/overlay').teamTheme('CIN'));
  await js(`
    $('share-theme-background').value = '#123456'; $('share-theme-background').dispatchEvent(new Event('input'));
    $('share-theme-accent').value = '#ff8800'; $('share-theme-accent').dispatchEvent(new Event('input'));
    $('share-opacity').value = 65; $('share-opacity').dispatchEvent(new Event('input'));
    $('share-theme-name').value = '<Custom theme>'; $('share-theme-save').click();
  `);
  await until(`!positionSaving && S.settings.overlayThemes.length === 1`);
  assert.equal(await js(`$('share-theme').selectedOptions[0].textContent`), '<Custom theme>');
  assert.equal(await js(`S.settings.overlayTheme`), null, 'named themes do not implicitly replace the default');
  await js(`$('share-theme-default').click()`);
  await until(`!positionSaving && S.settings.overlayOpacity === 0.65`);
  await js(`$('share-close').click(); $('btn-share').click()`);
  await until(`!$('share-position-preview').hidden`);
  assert.equal(await js(`$('share-opacity-value').textContent`), '65%');
  assert.equal(await js(`currentOverlayAppearance().background`), '#123456');
  for (const mode of ['sideline', 'endzone', 'both', 'sideline-first', 'endzone-first']) {
    for (const preset of ['original', 'top-left']) {
      for (const alpha of [0, 0.65, 1]) {
        const pixels = await js(`(() => {
          const appearance = A22.overlay.appearance({background: '#123456', accent: '#ff8800'}, ${alpha});
          const {canvas, bounds: b} = buildPlayCard(S.exportDraft.clips[0].play, '${mode}', S.exportDraft.matchup, null, {preset: '${preset}'}, appearance);
          const ctx = canvas.getContext('2d');
          const background = [...ctx.getImageData(b.x + 12, b.y + 12, 1, 1).data];
          const ink = ctx.getImageData(b.x + 24, b.y + 24, b.width - 48, b.height - 48).data;
          let opaque = 0;
          for (let i = 3; i < ink.length; i += 4) if (ink[i] === 255) opaque++;
          return {background, opaque};
        })()`);
        assert.ok(Math.abs(pixels.background[3] - Math.round(alpha * 255)) <= 1, `${mode}/${preset} background alpha`);
        if (alpha > 0) [18, 52, 86].forEach((value, i) => assert.ok(Math.abs(pixels.background[i] - value) <= 1));
        assert.ok(pixels.opaque > 100, 'text remains opaque even with transparent panels');
      }
    }
  }
  await js(`$('share-theme').value = 'saved-0'; $('share-theme').dispatchEvent(new Event('change')); $('share-theme-delete').click()`);
  await until(`!positionSaving && S.settings.overlayThemes.length === 0`);
  assert.equal(await js(`S.settings.overlayTheme.background`), '#123456', 'deletion does not change defaults');
  await js(`$('share-theme').value = 'auto'; $('share-theme').dispatchEvent(new Event('change')); $('share-theme-default').click()`);
  await until(`!positionSaving && S.settings.overlayTheme === null`);
  for (const mode of ['sideline', 'endzone', 'sideline-first', 'endzone-first', 'both']) {
    await js(`$('share-angle').value = '${mode}'; $('share-angle').dispatchEvent(new Event('change'));`);
    await until(`positionFrames?.mode === '${mode}'`);
    for (const preset of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      await js(`$('share-position').value = '${preset}'; $('share-position').dispatchEvent(new Event('change'));`);
      const bounds = await js(`positionBounds`);
      const size = await js(`A22.clipExport.dimensions('${mode}')`);
      assert.equal(bounds.x, preset.endsWith('right') ? size.width - bounds.width - 48 : 48);
      assert.equal(bounds.y, preset.startsWith('top') ? 48 : size.height - bounds.height - 48);
      assert.ok(bounds.width <= size.width * (mode === 'both' ? 0.9 : 0.72) + 1);
      const identical = await js(`(async () => {
        const card = buildPlayCard(S.exportDraft.clips[0].play, '${mode}', S.exportDraft.matchup, null, sharePosition);
        const image = new Image(); image.src = playCard(S.exportDraft.clips[0].play, '${mode}', S.exportDraft.matchup, null, sharePosition); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const b = card.bounds;
        return ctx.getImageData(b.x + 2, b.y + 2, 1, 1).data[3] > 0 && ctx.getImageData(0, 0, 1, 1).data[3] === 0;
      })()`);
      assert.ok(identical, `${mode} ${preset}: exported card pixels use the preview position`);
    }
  }
  await js(`
    $('share-position-x').value = 25; $('share-position-y').value = 40;
    $('share-position-x').dispatchEvent(new Event('input'));
    $('share-location-name').value = '<Custom>';
    $('share-location-save').click();
  `);
  await until(`!positionSaving && S.settings.overlayLocations.length === 1`);
  assert.deepEqual(await js('sharePosition'), { preset: 'custom', x: 0.25, y: 0.4 });
  assert.equal(await js(`$('share-position').selectedOptions[0].textContent`), '<Custom>');
  await js(`$('share-position-default').click()`);
  await until(`!positionSaving && S.settings.overlayPosition.preset === 'custom'`);
  const positionSaved = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  assert.deepEqual(positionSaved.overlayPosition, { preset: 'custom', x: 0.25, y: 0.4 });
  assert.deepEqual(positionSaved.overlayLocations, [{ name: '<Custom>', position: positionSaved.overlayPosition }]);
  await js(`$('share-close').click(); $('btn-share').click();`);
  await until(`!$('share-position-preview').hidden`);
  assert.deepEqual(await js('sharePosition'), positionSaved.overlayPosition);
  await js(`$('share-position').value = 'saved-0'; $('share-position').dispatchEvent(new Event('change'));`);
  assert.equal(await js(`$('share-location-delete').disabled`), false);
  await js(`$('share-location-delete').click()`);
  await until(`!positionSaving && S.settings.overlayLocations.length === 0`);
  assert.deepEqual(await js('S.settings.overlayPosition'), positionSaved.overlayPosition);
  await js(`$('share-position-preview').scrollIntoView({block: 'center'})`);
  const drag = await js(`(() => {
    const canvas = $('share-position-preview'), rect = canvas.getBoundingClientRect(), b = positionBounds;
    return {x: Math.round(rect.left + (b.x + b.width / 2) / canvas.width * rect.width),
      y: Math.round(rect.top + (b.y + b.height / 2) / canvas.height * rect.height)};
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...drag });
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...drag });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: drag.x + 25, y: drag.y + 35 });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: drag.x + 25, y: drag.y + 35 });
  await until(`sharePosition.x !== 0.25 && sharePosition.y !== 0.4`);
  const moved = await js('sharePosition');
  assert.ok(moved.x >= 0 && moved.x <= 1 && moved.y >= 0 && moved.y <= 1);
  await js(`$('share-clean').checked = true; $('share-clean').dispatchEvent(new Event('change'));`);
  assert.equal(await js(`$('share-positioning').disabled`), true);
  await js(`$('share-angle').value = 'sideline'; $('share-angle').dispatchEvent(new Event('change'));`);

  let destination;
  let replace = 0;
  let prompts = 0;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  dialog.showMessageBox = async () => { prompts++; return { response: replace }; };
  destination = path.join(root, 'positioned.mp4');
  await js(`
    $('share-clean').checked = false; $('share-clean').dispatchEvent(new Event('change'));
    $('share-angle').value = 'both'; $('share-angle').dispatchEvent(new Event('change'));
    $('share-position').value = 'top-right'; $('share-position').dispatchEvent(new Event('change'));
    $('share-overlay-seconds').value = '0.5';
    $('share-report-format').value = 'none';
  `);
  await until(`positionFrames?.mode === 'both' && positionHeadshots !== null`);
  const encodedBounds = await js('positionBounds');
  const encodedAppearance = await js('currentOverlayAppearance()');
  await js('exportSelection()');
  assert.equal(await js(`$('share-status').classList.contains('error')`), false, await js(`$('share-status').textContent`));
  const sample = (time, x, y) => {
    const result = spawnSync(require('ffmpeg-static'), ['-hide_banner', '-v', 'error', '-ss', String(time), '-i', destination,
      '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.equal(result.status, 0, String(result.stderr));
    assert.equal(result.stdout.length, 3);
    return [...result.stdout];
  };
  const before = sample(0.2, encodedBounds.x + 12, encodedBounds.y + 12);
  const expectedBackground = encodedAppearance.background.slice(1).match(/../g).map((part) => parseInt(part, 16) * encodedAppearance.opacity);
  assert.ok(before.every((value, i) => Math.abs(value - expectedBackground[i]) < 12), 'encoded overlay uses the preview theme, opacity, and top-right location');
  assert.ok(sample(0.8, encodedBounds.x + 12, encodedBounds.y + 12).every((v) => v < 30), 'overlay disappears after the chosen duration');
  const filmPixel = sample(0.2, 500, 400);
  assert.ok(filmPixel[0] > 180 && filmPixel[1] < 70, 'movable portrait overlay centers rather than shifts the film');
  await js(`
    $('share-clean').checked = true; $('share-clean').dispatchEvent(new Event('change'));
    $('share-angle').value = 'sideline'; $('share-angle').dispatchEvent(new Event('change'));
  `);
  let headshotRequests = 0;
  const photo = await js(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff8a24'; ctx.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png');
  })()`);
  ipcMain.removeHandler('players:headshots');
  ipcMain.handle('players:headshots', (_event, ids) => {
    headshotRequests++;
    return ids.map(id => id === '00-test-runner' ? { id, dataUrl: photo } : { id, warning: 'Photo unavailable' });
  });
  await js(`
    S.plays[0].playerIds.rusher = '00-test-runner';
    S.plays[1].playerIds.receiver = '00-test-receiver';
    positionHeadshots = null;
  `);
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
        assert.match(content.toString('latin1'), /\/Subtype\s*\/Image\b/, 'actual PDF embeds a headshot even though the video is clean');
        assert.equal(BrowserWindow.getAllWindows().length, 1, 'PDF renderer is destroyed');
        assert.match(await js(`$('share-status').textContent`), /Headshot notices:.*Photo unavailable/);
      }
    }
    assert.equal(headshotRequests, ['pdf', 'none'].includes(format) ? 1 : 0, 'only the clean PDF export requests headshots');
  }
  await assert.rejects(printPdf('<!doctype html>', {
    headshots: ['data:image/png;base64,iVBORw0KGgo='],
  }), /Could not decode a player headshot/);
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'invalid headshots do not leave a print window behind');
  destination = path.join(root, 'zero-overlay-headshots.mp4');
  await js(`
    $('share-clean').checked = false;
    $('share-overlay-seconds').value = '0';
    $('share-angle').value = 'sideline-first';
    $('share-report-format').value = 'pdf';
    exportSelection();
  `);
  assert.equal(await js(`$('share-status').classList.contains('error')`), false, await js(`$('share-status').textContent`));
  const groupedPdf = fs.readFileSync(path.join(root, 'zero-overlay-headshots-plays.pdf')).toString('latin1');
  assert.match(groupedPdf, /\/Subtype\s*\/Image\b/, 'grouped PDF retains headshots when overlay duration is zero');
  assert.equal(headshotRequests, 2);
  await js(`$('share-clean').checked = true; $('share-angle').value = 'sideline';`);
  destination = path.join(root, 'export-csv.mp4');
  const previousExport = fs.readFileSync(destination);
  await js(`$('share-report-format').value = 'csv'; exportSelection();`);
  assert.equal(prompts, 1);
  assert.match(await js(`$('share-status').textContent`), /cancelled/i);
  assert.deepEqual(fs.readFileSync(destination), previousExport);
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
