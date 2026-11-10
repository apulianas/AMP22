'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const align = require('../src/shared/align');
const plays = require('../src/shared/plays');
const settings = require('../src/shared/settings');
const clipExport = require('../src/shared/export');
const advanced = require('../src/shared/advanced');
const reports = require('../src/shared/reports');

function renderer({ cached = true, timers = { setTimeout: () => 1, clearTimeout() {} } } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      src: '', currentTime: 0, duration: 60, readyState: 1,
      innerHTML: '', textContent: '', style: {}, hidden: false, checked: false, disabled: false,
      get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
      classList: { toggle() {}, add() {}, remove() {} },
      pause() {}, load() {}, focus() {}, removeAttribute(name) { this[name] = ''; },
      setAttribute(name, value) { this[name] = value; }, decode: async () => {},
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      querySelectorAll: () => [], querySelector: () => ({ style: {} }),
    });
    return elements.get(id);
  };
  const pair = (start) => ({ sideline: { start, end: start + 5 }, endzone: { start: start + 5, end: start + 10 } });
  const films = {
    '/offense.mp4': { path: '/offense.mp4', url: 'file:///offense.mp4', info: { fps: 60 }, analysis: cached ? { pairs: [pair(0), pair(20)] } : null },
    '/defense.mp4': { path: '/defense.mp4', url: 'file:///defense.mp4', info: { fps: 30 }, analysis: cached ? { pairs: [pair(0), pair(20)] } : null },
  };
  let gameData = {
    filmFormat: 'split', filmPath: '/full-game.mp4',
    anchors: { 1: null }, offsets: { '0.00': 9 },
    splitFilmPaths: { BAL: { offense: '/offense.mp4', defense: '/defense.mp4' } },
    splitCorrections: { BAL: { offsets: { 'BAL:defense|0.00': 3 } } },
  };
  const api = {
    openFilm: async (file) => films[file],
    saveGame: async (_gameId, patch) => (gameData = { ...gameData, ...patch }),
  };
  const context = vm.createContext({
    structuredClone,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    A22: { align, plays, settings, clipExport, advanced, reports, filterPresets: require('../src/shared/filter-presets'), teams: require('../src/shared/teams'), overlay: require('../src/shared/overlay') },
    window: { addEventListener() {}, api },
    document: { getElementById: element, querySelectorAll: () => [] },
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('/* ---------------- boot')), context);
  vm.runInContext(`
    renderInfo = () => {};
    renderList = () => { S.visible = S.plays.map((_, i) => i); };
    markSelected = () => {};
    updateSelection = () => {};
    updateTimeUI = () => {};
    globalThis.renderer = { S, derivePlays, openSplitFilms, selectPlay, navClip, setAnchor,
      nudge, pairKey, realign, corrections, openShare, trimmedExportClips, updateExportOptions, selectTrimPlay, queueTrimPreview, analyze, closeFilm, setVideoTime,
      setCustomPosition, savePositionPreference, saveThemePreference, currentOverlayAppearance, toggleOverlay,
      setHighlightEditor: value => { highlightEditor = value; } };
  `, context);
  const r = context.renderer;
  element('share-angle').value = 'sideline';
  r.S.settings = settings.mergeSettings({ autoAnalyze: false });
  r.S.sel = { gameId: 'game', team: 'BAL' };
  r.S.gameData = gameData;
  r.S.plays = ['BAL', 'BUF', 'BAL', 'BUF', 'BAL'].map((team, i) => plays.normalizePlay({
    play_id: i + 1, posteam: team, defteam: team === 'BAL' ? 'BUF' : 'BAL',
    play_type: i === 4 ? 'punt' : 'run', qtr: 1, time: '12:00', desc: 'A real play',
  }));
  r.derivePlays();
  return { ...r, api, films, elements, element };
}

test('background tracking does not block closing Share or clean exports, but pending highlights cannot export', async () => {
  const r = renderer();
  await r.openSplitFilms();
  r.selectPlay(0, { autoplay: false });
  let paused = 0;
  r.setHighlightEditor({ busy: () => true, select() {}, refresh() {}, pause: () => { paused++; } });
  r.openShare();
  assert.equal(r.element('share-export').disabled, true);
  assert.match(r.element('share-status').textContent, /tracking is running in the background/);
  assert.equal(r.element('share-close').disabled, false);
  assert.equal(r.element('share-trimming').disabled, false);
  assert.equal(r.element('share-angle').disabled, false);
  r.element('share-clean').checked = true;
  r.updateExportOptions();
  assert.equal(r.element('share-export').disabled, false);
  r.toggleOverlay('share', false);
  assert.equal(r.element('share').hidden, true);
  assert.ok(paused > 0);
  r.S.exporting = true;
  r.updateExportOptions();
  assert.equal(r.element('share-export').disabled, true, 'actual encoding still blocks another export');
});

test('split playback switches source and frame rate while keeping file-specific offsets and corrections', async () => {
  const r = renderer();
  await r.openSplitFilms();
  assert.deepEqual(Array.from(r.S.mapping), [0, 2, 1, 3, null]);
  assert.equal(r.element('vidA').src, 'file:///offense.mp4');
  r.selectPlay(1, { autoplay: false });
  assert.equal(r.element('vidA').src, 'file:///defense.mp4');
  assert.equal(r.element('vidB').src, 'file:///defense.mp4');
  assert.equal(r.S.fps, 30);
  assert.ok(Math.abs(r.S.range.bStart - 5.108) < 1e-9);
  await r.nudge(1);
  assert.equal(r.corrections().offsets['BAL:defense|0.00'], 4);
  assert.equal(r.S.gameData.offsets['0.00'], 9, 'single-file offsets remain untouched');
  r.selectPlay(0, { autoplay: false });
  assert.equal(r.element('vidA').src, 'file:///offense.mp4');
  assert.equal(r.S.fps, 60);
  assert.equal(r.S.range.bStart, 5.008, 'offense does not inherit defense offsets');
  await r.setAnchor(r.S.plays[0], null);
  assert.equal(r.S.mapping[0], null);
  assert.equal(r.S.mapping[1], 2, 'offense correction does not shift defense');
  r.S.gameData.filmFormat = 'single';
  assert.equal(r.corrections().anchors[1], null);
  r.S.gameData.filmFormat = 'split';
  r.S.sel.team = 'BUF';
  assert.equal(r.corrections().anchors, undefined, 'opposing team has separate split corrections');
});

test('clip browsing stays in the selected unit and a missing special-teams file stays unlinked', async () => {
  const r = renderer();
  await r.openSplitFilms();
  r.selectPlay(1, { autoplay: false });
  assert.equal(r.navClip(1, false), true);
  assert.equal(r.S.curPair, 3);
  assert.equal(r.navClip(1, false), false);
  r.selectPlay(0, { autoplay: false });
  assert.equal(r.navClip(-1, false), false);
  r.selectPlay(4, { autoplay: false });
  assert.equal(r.S.curPair, -1);
  assert.equal(r.S.range, null);
  assert.equal(r.navClip(1, false), false);
  assert.match(r.element('message').innerHTML, /special-teams file/);
  r.S.curPair = 0;
  await r.setAnchor(r.S.plays[4], r.pairKey(r.S.pairs[0]));
  assert.equal(r.corrections().anchors, undefined);
  assert.match(r.element('status').textContent, /offense, defense, or special-teams file/);
});

test('selecting a missing split source opens viewer film setup without losing loaded sources', async () => {
  const r = renderer();
  await r.openSplitFilms();
  assert.equal(r.element('film-setup').hidden, true);
  r.selectPlay(4, { autoplay: false });
  assert.equal(r.element('film-setup').hidden, false);
  assert.equal(r.S.filmSetupOpen, true);
  assert.match(r.element('film-setup-message').innerHTML, /matching offense, defense, or special-teams/);
  assert.equal(r.S.splitFilms.offense.path, '/offense.mp4');
  r.selectPlay(0, { autoplay: false });
  assert.equal(r.element('film-setup').hidden, true);
  assert.equal(r.S.filmSetupOpen, false);
});

test('special teams have independent playback, corrections, and export sources', async () => {
  const r = renderer();
  r.S.gameData.splitFilmPaths.BAL.special = '/special.mp4';
  r.films['/special.mp4'] = {
    path: '/special.mp4', url: 'file:///special.mp4', info: { fps: 24 },
    analysis: { pairs: [{ sideline: { start: 0, end: 5 }, endzone: { start: 5, end: 10 } }] },
  };
  await r.openSplitFilms();
  assert.deepEqual(Array.from(r.S.mapping), [0, 2, 1, 3, 4]);
  r.selectPlay(4, { autoplay: false });
  assert.equal(r.element('vidA').src, 'file:///special.mp4');
  assert.equal(r.S.fps, 24);
  assert.equal(r.navClip(1, false), false);
  await r.nudge(2);
  assert.equal(r.corrections().offsets['BAL:special|0.00'], 2);
  r.S.selected = new Set([4, 1, 0]);
  r.openShare();
  assert.deepEqual(Array.from(r.S.exportDraft.clips, (clip) => clip.file), ['/offense.mp4', '/defense.mp4', '/special.mp4']);
  await r.setAnchor(r.S.plays[4], null);
  assert.equal(r.S.mapping[4], null);
  assert.equal(r.S.mapping[1], 2);
});

test('mixed exports carry each play source and frame rate in game order', async () => {
  const r = renderer();
  await r.openSplitFilms();
  r.S.selected = new Set([3, 0, 1]);
  r.openShare();
  assert.deepEqual(Array.from(r.S.exportDraft.clips, (clip) => clip.file), ['/offense.mp4', '/defense.mp4', '/defense.mp4']);
  assert.deepEqual(Array.from(r.S.exportDraft.clips, (clip) => clip.play.playId), [1, 2, 4]);
  assert.ok(Math.abs(r.S.exportDraft.clips[1].bStart - 5.108) < 1e-9);
  r.S.selected.add(4);
  r.openShare();
  assert.equal(r.S.exportDraft, null);
  assert.match(r.element('share-status').textContent, /no linked film/);
});

test('Share starts with remembered decimals, keeps per-play overrides, and blocks invalid trims', async () => {
  const r = renderer();
  await r.openSplitFilms();
  r.S.settings.exportTrim = 1.25;
  r.S.settings.overlaySeconds = 2.75;
  r.S.selected = new Set([0, 1]);
  r.openShare();
  assert.equal(r.element('share-export').disabled, false);
  assert.equal(r.element('share-overlay-seconds').value, 2.75);
  assert.deepEqual(Array.from(r.S.exportDraft.clips, (clip) => clip.trim), [1.25, 1.25]);
  const original = r.S.exportDraft.clips[0].aStart;
  r.S.exportDraft.clips[0].trim = 0.125;
  r.element('share-preview-play').value = '0';
  r.selectTrimPlay();
  assert.equal(r.element('share-trim').value, 0.125);
  r.element('share-preview-play').value = '1';
  r.selectTrimPlay();
  assert.equal(r.element('share-trim').value, 1.25);
  const clips = r.trimmedExportClips();
  assert.equal(clips[0].aStart, original + 0.125);
  assert.equal(r.S.exportDraft.clips[0].aStart, original);
  assert.equal(r.S.settings.exportTrim, 1.25);
  r.S.exportDraft.clips[1].trim = 999;
  r.updateExportOptions();
  assert.equal(r.element('share-export').disabled, true);
  assert.match(r.element('share-status').textContent, /Play 2.*Trim/);
  r.S.exportDraft.clips[1].trim = 0;
  r.updateExportOptions();
  assert.equal(r.element('share-export').disabled, false);
  r.element('share-overlay-seconds').value = '';
  r.updateExportOptions();
  assert.equal(r.element('share-export').disabled, true);
});

test('trim previews follow the export mode and ignore stale angle requests', async () => {
  let pendingTimer;
  const timers = {
    setTimeout(fn) { pendingTimer = fn; return fn; },
    clearTimeout(id) { if (pendingTimer === id) pendingTimer = null; },
    run() {
      const fn = pendingTimer;
      assert.ok(fn, 'preview timer scheduled');
      pendingTimer = null;
      return fn();
    },
  };
  const r = renderer({ timers });
  await r.openSplitFilms();
  r.S.settings.exportTrim = 0.25;
  r.S.selected = new Set([0, 1]);
  r.element('share-preview-play').value = '0';
  const requests = [];
  r.api.previewFrame = async (file, time) => {
    requests.push({ file, time });
    return `frame:${time}`;
  };
  r.openShare();
  const clip = r.S.exportDraft.clips[0];
  const starts = { a: clip.aStart + clip.trim, b: clip.bStart + clip.trim };

  for (const [mode, showA, showB] of [
    ['sideline', true, false], ['endzone', false, true], ['both', true, true],
    ['sideline-first', true, true], ['endzone-first', true, true],
  ]) {
    if (mode !== 'sideline') {
      r.element('share-angle').value = mode;
      r.queueTrimPreview();
    }
    assert.equal(r.element('share-preview-figure-a').hidden, !showA, mode);
    assert.equal(r.element('share-preview-figure-b').hidden, !showB, mode);
    assert.equal(r.element('share-preview-a').hidden, true, 'old images hidden while loading');
    assert.equal(r.element('share-preview-b').hidden, true, 'old images hidden while loading');
    requests.length = 0;
    await timers.run();
    assert.deepEqual(requests.map((request) => request.time), [
      ...(showA ? [starts.a] : []), ...(showB ? [starts.b] : []),
    ], mode);
    assert.ok(requests.every((request) => request.file === clip.file));
    assert.equal(r.element('share-preview-a').hidden, !showA, mode);
    assert.equal(r.element('share-preview-b').hidden, !showB, mode);
    if (showA) assert.equal(r.element('share-preview-a').src, `frame:${starts.a}`);
    if (showB) assert.equal(r.element('share-preview-b').src, `frame:${starts.b}`);
    assert.equal(clip.trim, 0.25, 'changing angles preserves the trim');
  }

  requests.length = 0;
  r.element('share-preview-play').value = '1';
  r.selectTrimPlay();
  await timers.run();
  const defenseClip = r.S.exportDraft.clips[1];
  assert.deepEqual(requests.map((request) => request.file), [defenseClip.file, defenseClip.file]);
  assert.deepEqual(requests.map((request) => request.time), [
    defenseClip.aStart + defenseClip.trim, defenseClip.bStart + defenseClip.trim,
  ]);
  r.element('share-preview-play').value = '0';
  r.selectTrimPlay();

  let finishOld;
  r.api.previewFrame = (_file, time) => time === starts.a
    ? new Promise((resolve) => { finishOld = resolve; })
    : Promise.resolve('new end-zone frame');
  r.element('share-angle').value = 'sideline';
  r.queueTrimPreview();
  const oldRequest = timers.run();
  r.element('share-angle').value = 'endzone';
  r.queueTrimPreview();
  await timers.run();
  finishOld('stale sideline frame');
  await oldRequest;
  assert.equal(r.element('share-preview-figure-a').hidden, true);
  assert.equal(r.element('share-preview-a').hidden, true);
  assert.equal(r.element('share-preview-figure-b').hidden, false);
  assert.equal(r.element('share-preview-b').src, 'new end-zone frame');
  assert.equal(r.element('share-preview-b').hidden, false);
});

test('Share uses saved breakdown defaults while allowing format and advanced-statistic overrides', async () => {
  const r = renderer();
  await r.openSplitFilms();
  r.S.selected = new Set([0]);
  r.openShare();
  assert.equal(r.element('share-report-format').value, 'csv');
  assert.equal(r.element('share-report-advanced').checked, false);
  r.S.settings.playReport = { format: 'pdf', includeAdvanced: true, fields: ['motion', 'coverage'] };
  r.openShare();
  assert.equal(r.element('share-report-format').value, 'pdf');
  assert.equal(r.element('share-report-advanced').checked, true);
  assert.match(r.element('share-report-fields').textContent, /Motion, Coverage/);
  assert.ok(!r.element('share-report-fields').textContent.includes('Air yards'));
});

test('overlay preferences save explicitly and failed writes retain the previous default', async () => {
  const r = renderer();
  await r.openSplitFilms();
  r.S.selected = new Set([0]);
  r.openShare();
  r.setCustomPosition(0.2, 0.6);
  assert.equal(r.S.settings.overlayPosition.preset, 'original', 'moving is not a settings write');
  r.api.saveSettings = async (value) => settings.mergeSettings(JSON.parse(JSON.stringify(value)));
  r.element('share-location-name').value = 'My spot';
  await r.savePositionPreference('save');
  assert.equal(r.S.settings.overlayLocations.length, 1);
  assert.equal(r.S.settings.overlayPosition.preset, 'original', 'saving a location does not make it the default');
  await r.savePositionPreference('default');
  assert.deepEqual(JSON.parse(JSON.stringify(r.S.settings.overlayPosition)), { preset: 'custom', x: 0.2, y: 0.6 });
  r.setCustomPosition(0.8, 0.1);
  r.api.saveSettings = async () => { throw new Error('Disk full'); };
  await r.savePositionPreference('default');
  assert.match(r.element('share-position-saved').textContent, /Could not save overlay preference: Disk full/);
  assert.deepEqual(JSON.parse(JSON.stringify(r.S.settings.overlayPosition)), { preset: 'custom', x: 0.2, y: 0.6 });
  assert.equal(r.element('share-positioning').disabled, false);
  assert.equal(r.element('share-export').disabled, false);
});

test('overlay defaults follow the analyzed team, and custom theme saves preserve automatic/default semantics', async () => {
  const r = renderer();
  await r.openSplitFilms();
  r.S.selected = new Set([0]);
  r.api.saveSettings = async (value) => settings.mergeSettings(JSON.parse(JSON.stringify(value)));
  r.openShare();
  assert.equal(r.currentOverlayAppearance().background, require('../src/shared/overlay').teamTheme('BAL').background);
  r.S.sel.team = 'BUF';
  r.openShare();
  assert.equal(r.currentOverlayAppearance().background, require('../src/shared/overlay').teamTheme('BUF').background);
  r.element('share-theme-name').value = 'My theme';
  await r.saveThemePreference('save');
  assert.equal(r.S.settings.overlayThemes.length, 1);
  assert.equal(r.S.settings.overlayTheme, null, 'saving a theme does not change automatic selection');
  await r.saveThemePreference('default');
  assert.equal(r.S.settings.overlayTheme.background, r.currentOverlayAppearance().background);
  r.S.sel.team = 'BAL';
  r.openShare();
  assert.equal(r.currentOverlayAppearance().background, r.S.settings.overlayTheme.background);
  r.api.saveSettings = async () => { throw new Error('Disk full'); };
  await r.saveThemePreference('default');
  assert.match(r.element('share-theme-status').textContent, /Could not save overlay theme: Disk full/);
  assert.equal(r.element('share-theming').disabled, false);
  assert.equal(r.element('share-export').disabled, false);
  r.element('share-clean').checked = true;
  await r.saveThemePreference('delete');
  assert.equal(r.S.settings.overlayThemes.length, 1, 'clean exports cannot change theme preferences');
});

test('uncached split files analyze once each and retain separate results', async () => {
  const r = renderer({ cached: false });
  const files = [];
  r.api.analyzeFilm = async (file) => {
    files.push(file);
    return { pairs: [{ sideline: { start: 0, end: 5 }, endzone: { start: 5, end: 10 } }] };
  };
  r.S.settings.autoAnalyze = true;
  await r.openSplitFilms();
  assert.deepEqual(files, ['/offense.mp4', '/defense.mp4']);
  assert.equal(r.S.pairs.length, 2);
  assert.equal(r.S.splitFilms.offense.analysis.pairs.length, 1);
  assert.equal(r.S.splitFilms.defense.analysis.pairs.length, 1);
  assert.equal(r.element('btn-analyze').hidden, true);
  await r.analyze(false);
  assert.equal(files.length, 2);
});

test('stale analysis cannot replace a newly opened game or clear its progress', async () => {
  const r = renderer({ cached: false });
  await r.openSplitFilms();
  let finish;
  r.api.analyzeFilm = () => new Promise((resolve) => { finish = resolve; });
  const running = r.analyze(false);
  r.closeFilm();
  const newerRun = {};
  r.S.analyzing = newerRun;
  r.S.progressFile = '/new.mp4';
  finish({ pairs: [{ sideline: { start: 99, end: 100 } }] });
  await running;
  assert.equal(r.S.pairs.length, 0);
  assert.equal(r.S.analyzing, newerRun);
  assert.equal(r.S.progressFile, '/new.mp4');
});

test('source-open failures are reported without assigning the other unit to missing film', async () => {
  const r = renderer();
  const open = r.api.openFilm;
  r.api.openFilm = async (file) => {
    if (file === '/offense.mp4') throw new Error('Film was moved');
    return open(file);
  };
  await r.openSplitFilms();
  assert.match(r.element('status').textContent, /offense: Film was moved/);
  assert.deepEqual(Array.from(r.S.mapping), [null, 0, null, 1, null]);
});

test('source switches defer seeking until video metadata is ready', () => {
  const r = renderer();
  const video = r.element('vidA');
  video.readyState = 0;
  r.setVideoTime(video, 25);
  assert.equal(video.currentTime, 0);
  assert.equal(video._pending, 25);
  video.readyState = 1;
  r.setVideoTime(video, 25);
  assert.equal(video.currentTime, 25);
  r.closeFilm();
  assert.equal(video._pending, null);
  assert.equal(video._target, null);
});
