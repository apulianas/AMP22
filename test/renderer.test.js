'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const plays = require('../src/shared/plays');
const settings = require('../src/shared/settings');
const clipExport = require('../src/shared/export');

function renderer() {
  const elements = new Map();
  const context = vm.createContext({
    A22: { plays, settings, clipExport },
    window: { addEventListener() {} },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', querySelector: () => null });
        return elements.get(id);
      },
    },
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  // Exercise renderer functions without starting Electron or the asynchronous app boot.
  vm.runInContext(source.slice(0, source.indexOf('/* ---------------- boot')), context);
  vm.runInContext(`
    updateSelection = () => {};
    selectPlay = (i) => { S.curPlay = i; };
    globalThis.renderer = { S, derivePlays, renderList, navPlay };
  `, context);
  const api = context.renderer;
  api.S.settings = { keyPlays: {}, skipNoFilm: false };
  api.S.plays = [
    { air_yards: '5', play_type: 'pass', posteam: 'BAL', fixed_drive: '1' },
    { air_yards: '', play_type: 'run', posteam: 'BAL', fixed_drive: '1' },
    { air_yards: '39', play_type: 'pass', posteam: 'BUF', fixed_drive: '2' },
    { air_yards: '-3', play_type: 'pass', posteam: 'BAL', fixed_drive: '3' },
    { air_yards: '0', play_type: 'pass', posteam: 'BAL', fixed_drive: '3' },
  ].map((row, i) => plays.normalizePlay({ play_id: String(i + 1), desc: 'A pass or run', yrdln: 'BAL 25', ...row }));
  api.S.mapping = [4, 3, 2, 1, 0];
  api.derivePlays();
  return { ...api, elements, visible: () => Array.from(api.S.visible) };
}

test('renderer displays air yards without changing play indices, film mapping, or drive grouping', () => {
  const r = renderer();
  r.renderList();
  assert.deepEqual(r.visible(), [0, 1, 2, 3, 4]);
  assert.equal((r.elements.get('play-list').innerHTML.match(/class="drive-head"/g) || []).length, 3);
  const html = r.elements.get('play-list').innerHTML;
  assert.ok(html.includes('Air: 39 yd'));
  assert.ok(html.includes('Air: 0 yd'));
  assert.ok(html.includes('Air: -3 yd'));
  assert.equal((html.match(/Air:/g) || []).length, 4);
  r.S.filter.airMin = 0;
  r.renderList();
  assert.deepEqual(r.visible(), [0, 2, 4]);
  assert.deepEqual(r.S.mapping, [4, 3, 2, 1, 0]);
  assert.deepEqual(r.S.plays.map((p) => p.playId), [1, 2, 3, 4, 5]);
});

test('air-yard bounds are inclusive, optional, and distinguish missing yards from zero', () => {
  const r = renderer();
  for (const [min, max, expected] of [
    [null, null, [0, 1, 2, 3, 4]],
    [5, null, [0, 2]],
    [null, 5, [0, 3, 4]],
    [0, 5, [0, 4]],
    [0, 0, [4]],
    [-3, -3, [3]],
    [null, -1, [3]],
    [5, 39, [0, 2]],
    [5.1, 39, [2]],
    [40, null, []],
    [10, 5, []],
  ]) {
    r.S.filter.airMin = min;
    r.S.filter.airMax = max;
    r.renderList();
    assert.deepEqual(r.visible(), expected, `bounds ${min} to ${max}`);
  }
});

test('air-yard bounds combine with offense, play type, and search filters', () => {
  const r = renderer();
  r.S.filter.airMin = 0;
  r.S.filter.offense = 'BAL';
  r.renderList();
  assert.deepEqual(r.visible(), [0, 4]);
  r.S.filter.type = 'run';
  r.renderList();
  assert.deepEqual(r.visible(), []);
  r.S.filter.type = 'pass';
  r.S.filter.text = 'not present';
  r.renderList();
  assert.deepEqual(r.visible(), []);
  r.S.filter.text = 'pass';
  r.renderList();
  assert.deepEqual(r.visible(), [0, 4]);
});

test('navigation follows filtered rows, including hidden current plays and unavailable film', () => {
  const r = renderer();
  r.S.filter.airMin = 0;
  r.renderList();
  r.S.curPlay = 0;
  assert.equal(r.navPlay(1), true);
  assert.equal(r.S.curPlay, 2);
  assert.equal(r.navPlay(-1), true);
  assert.equal(r.S.curPlay, 0);
  assert.equal(r.navPlay(-1), false);
  r.S.curPlay = 4;
  assert.equal(r.navPlay(1), false);
  r.S.curPlay = 1;
  assert.equal(r.navPlay(-1), true);
  assert.equal(r.S.curPlay, 0);
  r.S.curPlay = 1;
  assert.equal(r.navPlay(1), true);
  assert.equal(r.S.curPlay, 2);
  r.S.filter.airMin = 5;
  r.renderList();
  r.S.curPlay = 4;
  assert.equal(r.navPlay(1), false);
  assert.equal(r.navPlay(-1), true);
  assert.equal(r.S.curPlay, 2);
  r.S.filter.airMin = 0;
  r.renderList();
  r.S.pairs = [{}, {}, {}, {}, {}];
  r.S.settings.skipNoFilm = true;
  r.S.mapping[2] = null;
  r.S.curPlay = 0;
  assert.equal(r.navPlay(1), true);
  assert.equal(r.S.curPlay, 4);
});

test('Shift-click ranges and exports retain the filtered game order', () => {
  const r = renderer();
  r.S.filter.airMin = 0;
  r.renderList();
  const selection = clipExport.selectionRange(r.S.visible, 0, 4);
  assert.deepEqual(Array.from(selection), [0, 2, 4]);
  assert.deepEqual(clipExport.selectedIndices(new Set(selection)), [0, 2, 4]);
});
