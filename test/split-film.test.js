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

function renderer({ cached = true } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      src: '', currentTime: 0, duration: 60, readyState: 1,
      innerHTML: '', textContent: '', style: {}, hidden: false,
      classList: { toggle() {}, add() {}, remove() {} },
      pause() {}, load() {}, focus() {}, removeAttribute(name) { this[name] = ''; },
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
    A22: { align, plays, settings, clipExport, advanced, reports },
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
      nudge, pairKey, realign, corrections, openShare, analyze, closeFilm, setVideoTime };
  `, context);
  const r = context.renderer;
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
