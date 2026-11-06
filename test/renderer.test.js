'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const plays = require('../src/shared/plays');
const settings = require('../src/shared/settings');
const clipExport = require('../src/shared/export');
const advanced = require('../src/shared/advanced');
const reports = require('../src/shared/reports');

function renderer() {
  const elements = new Map();
  const context = vm.createContext({
    A22: { plays, settings, clipExport, advanced, reports, align: require('../src/shared/align'), overlay: require('../src/shared/overlay') },
    window: { addEventListener() {}, open: () => null },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          innerHTML: '', textContent: '', querySelector: () => null,
          setAttribute(name, value) { this[name] = value; },
          focus() {},
          classList: { toggle() {}, add() {}, remove() {} },
        });
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
    globalThis.renderer = { S, derivePlays, renderList, navPlay, renderAdvancedFilters, setAdvancedChoice, removePlayerFilter, renderInfo, popAngle, updateAngleButtons, renderUpdate, checkUpdates, closeUpdate, handleKeydown, renderFilmSetup, refreshParticipation };
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
  return { ...api, elements, context, visible: () => Array.from(api.S.visible) };
}

test('on-field filter matches stable IDs instead of description mentions and composes with other filters', () => {
  const r = renderer();
  r.S.plays[0].onField = { offense: [{ id: '00-1', name: 'Blocking Receiver', position: 'WR', number: '11' }], defense: [] };
  r.S.plays[2].onField = { offense: [], defense: [{ id: '00-1', name: 'Blocking Receiver', position: 'WR', number: '11' }] };
  r.derivePlays();
  r.renderAdvancedFilters();
  assert.match(r.elements.get('player-choice').innerHTML, /On-field player/);
  assert.match(r.elements.get('player-choice').innerHTML, /Blocking Receiver/);
  r.S.filter.choices.player = ['00-1'];
  r.renderList();
  assert.deepEqual(r.visible(), [0, 2]);
  r.S.filter.offense = 'BAL';
  r.renderList();
  assert.deepEqual(r.visible(), [0]);
  r.S.filter.text = 'blocking';
  r.renderList();
  assert.deepEqual(r.visible(), [0]);
});

function contextualPlayers() {
  const r = renderer();
  const player = (id, name, position) => ({ id, name, position });
  const henry = player('henry', 'Derrick Henry', 'RB');
  const jaguarDefender = player('jax-def', 'Jaguars Defender', 'CB');
  const quarterback = player('lawrence', 'Trevor Lawrence', 'QB');
  const ravenDefender = player('smith', 'Roquan Smith', 'ILB');
  r.S.plays[0].onField = { offense: [henry], defense: [jaguarDefender] };
  r.S.plays[1].onField = { offense: [henry], defense: [jaguarDefender] };
  Object.assign(r.S.plays[2], {
    posteam: 'JAX', defteam: 'BAL', qtr: 1, charting: { motion: true },
    onField: { offense: [quarterback, player('hunter', 'Travis Hunter', 'WR')],
      defense: [ravenDefender, { sourceId: '202', name: 'Actual Defending RB', position: 'RB' }] },
  });
  Object.assign(r.S.plays[3], {
    posteam: 'JAX', defteam: 'BAL', qtr: 2, charting: { motion: false },
    onField: { offense: [quarterback], defense: [ravenDefender, player('q2-only', 'Second Quarter Corner', 'CB')] },
  });
  r.derivePlays();
  r.renderAdvancedFilters();
  return r;
}

function playerOptionIds(r) {
  return [...r.elements.get('player-choice').innerHTML.matchAll(/<option value="([^"]+)"/g)]
    .map(match => match[1]).sort();
}

function playerOptionCounts(r) {
  return Object.fromEntries([...r.elements.get('player-choice').innerHTML
    .matchAll(/<option value="([^"]+)">[^<]*\((\d+) plays?\)<\/option>/g)]
    .map(match => [match[1], Number(match[2])]));
}

function playerOptionGroups(r) {
  return [...r.elements.get('player-choice').innerHTML.matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)]
    .map(match => ({ label: match[1], ids: [...match[2].matchAll(/<option value="([^"]+)"/g)].map(option => option[1]) }));
}

function playerOrdering() {
  const r = contextualPlayers();
  const zebra = { id: 'zebra-cb', name: 'Zebra Corner', position: 'CB' };
  r.S.plays[2].onField.defense.push(zebra,
    { id: 'alpha-ilb', name: 'Alpha Linebacker', position: 'ILB' },
    { id: 'alpha-cb', name: 'Alpha Corner', position: 'CB' });
  r.S.plays[3].onField.defense.push(zebra);
  r.S.sel.team = 'BAL';
  r.S.settings.defaultTeam = 'JAX';
  r.S.filter.offense = 'JAX';
  r.derivePlays();
  r.renderAdvancedFilters();
  r.renderList();
  return r;
}

test('player dropdown groups the analyzed team first, not the filtered offense or default team, and defaults to alphabetical within teams', () => {
  const r = playerOrdering();
  assert.deepEqual(playerOptionGroups(r), [
    { label: 'BAL · Analyzed team', ids: ['nflpro:202', 'alpha-cb', 'alpha-ilb', 'smith', 'q2-only', 'zebra-cb'] },
    { label: 'JAX', ids: ['hunter', 'lawrence'] },
  ]);
  r.S.sel.team = 'JAX';
  r.renderList();
  assert.deepEqual(playerOptionGroups(r).map(group => group.label), ['JAX · Analyzed team', 'BAL']);
  assert.deepEqual(playerOptionGroups(r)[0].ids, ['hunter', 'lawrence']);
});

test('play-count sorting is descending inside each team, breaks ties alphabetically and reorders as selected players change', () => {
  const r = playerOrdering();
  r.S.settings.playerFilterSort = 'plays';
  r.renderList();
  const initial = playerOptionGroups(r);
  assert.deepEqual(initial, [
    { label: 'BAL · Analyzed team', ids: ['smith', 'zebra-cb', 'nflpro:202', 'alpha-cb', 'alpha-ilb', 'q2-only'] },
    { label: 'JAX', ids: ['lawrence', 'hunter'] },
  ]);
  const mapping = Array.from(r.S.mapping);
  r.setAdvancedChoice('player', 'hunter');
  assert.deepEqual(playerOptionGroups(r)[0].ids, ['nflpro:202', 'alpha-cb', 'alpha-ilb', 'smith', 'zebra-cb']);
  assert.equal(playerOptionCounts(r)['q2-only'], undefined);
  r.removePlayerFilter('hunter');
  assert.deepEqual(playerOptionGroups(r), initial);
  assert.deepEqual(Array.from(r.S.mapping), mapping);
});

test('position sorting uses the shared football order and sorts within each position by current play count then name', () => {
  const r = playerOrdering();
  r.S.settings.playerFilterSort = 'position';
  r.renderList();
  assert.deepEqual(playerOptionGroups(r), [
    { label: 'BAL · Analyzed team', ids: ['nflpro:202', 'smith', 'alpha-ilb', 'zebra-cb', 'alpha-cb', 'q2-only'] },
    { label: 'JAX', ids: ['hunter', 'lawrence'] },
  ]);
  r.setAdvancedChoice('player', 'hunter');
  assert.deepEqual(playerOptionGroups(r)[0].ids, ['nflpro:202', 'alpha-ilb', 'smith', 'alpha-cb', 'zebra-cb']);
  assert.deepEqual(Array.from(r.S.filter.choices.player), ['hunter']);
  assert.deepEqual(r.visible(), [2]);
});

test('player dropdown position sorting marks inferred sides without assigning a snap-specific eligible role to a whole player', () => {
  const r = renderer();
  r.S.sel.team = 'BAL';
  r.S.settings.playerFilterSort = 'position';
  r.S.plays[0].onField = {
    offense: [
      { id: 'right', name: 'Right Tackle', position: 'T', positionInference: { position: 'RT' } },
      { id: 'left', name: 'Left Tackle', position: 'T', positionInference: { position: 'LT' } },
      { id: 'generic', name: 'Extra Tackle', position: 'T', eligibleReceiver: true },
      { id: 'receiver', name: 'Receiver', position: 'WR' },
    ], defense: [],
  };
  r.derivePlays();
  r.renderAdvancedFilters();
  assert.deepEqual(playerOptionGroups(r)[0].ids, ['receiver', 'left', 'right', 'generic']);
  assert.match(r.elements.get('player-choice').innerHTML, /Left Tackle · BAL LT\* \(1 play\)/);
  assert.match(r.elements.get('player-choice').innerHTML, /Extra Tackle · BAL T \(1 play\)/);
  assert.doesNotMatch(r.elements.get('player-choice').innerHTML, /OL-E/);
});

test('player option counts predict adding a candidate to every selected player and update on additions, removals and other filters', () => {
  const r = contextualPlayers();
  r.S.filter.offense = 'JAX';
  r.renderList();
  assert.deepEqual(playerOptionCounts(r), { hunter: 1, lawrence: 2, 'nflpro:202': 1, 'q2-only': 1, smith: 2 });
  r.setAdvancedChoice('player', 'hunter');
  assert.deepEqual(playerOptionCounts(r), { lawrence: 1, 'nflpro:202': 1, smith: 1 });
  assert.doesNotMatch(r.elements.get('player-choice').innerHTML, /Second Quarter Corner|\(0 plays\)/);
  assert.match(r.elements.get('player-choice').innerHTML, /Trevor Lawrence.*\(1 play\)/);
  r.setAdvancedChoice('player', 'lawrence');
  assert.deepEqual(playerOptionCounts(r), { 'nflpro:202': 1, smith: 1 });
  r.removePlayerFilter('hunter');
  assert.deepEqual(playerOptionCounts(r), { hunter: 1, 'nflpro:202': 1, 'q2-only': 1, smith: 2 });
  r.S.filter.qtr = '2';
  r.renderList();
  assert.deepEqual(playerOptionCounts(r), { 'q2-only': 1, smith: 1 });
  r.S.filter.qtr = '';
  r.setAdvancedChoice('player', 'q2-only');
  assert.equal(playerOptionCounts(r).hunter, undefined);
  r.removePlayerFilter('q2-only');
  assert.equal(playerOptionCounts(r).hunter, 1);
  r.removePlayerFilter('lawrence');
  assert.equal(playerOptionCounts(r).lawrence, 2);
});

test('player counts count each matching play once per identity and never invent participation on missing-data plays', () => {
  const r = contextualPlayers();
  r.S.plays[2].onField.defense.push(r.S.plays[2].onField.offense[0]);
  r.S.plays[4].posteam = 'JAX';
  r.S.filter.offense = 'JAX';
  r.derivePlays();
  r.renderList();
  assert.deepEqual(r.visible(), [2, 3, 4]);
  assert.equal(playerOptionCounts(r).lawrence, 2, 'duplicate appearances in a play count once');
  assert.equal(playerOptionCounts(r).smith, 2, 'a play without participation does not inflate player counts');
  assert.equal(playerOptionCounts(r).hunter, 1);
});

test('player options follow offense, quarter, type, ranges, charting and search using actual snap membership', () => {
  const r = contextualPlayers();
  const mapping = Array.from(r.S.mapping);
  const weights = Array.from(r.S.plays, p => p.filmWeight);
  r.S.filter.offense = 'JAX';
  r.renderList();
  assert.deepEqual(playerOptionIds(r), ['hunter', 'lawrence', 'nflpro:202', 'q2-only', 'smith']);
  assert.doesNotMatch(r.elements.get('player-choice').innerHTML, /Derrick Henry|Jaguars Defender/);
  assert.match(r.elements.get('player-choice').innerHTML, /Actual Defending RB/, 'membership, not listed position, determines availability');
  r.S.filter.qtr = '1';
  r.renderList();
  assert.deepEqual(playerOptionIds(r), ['hunter', 'lawrence', 'nflpro:202', 'smith']);
  r.S.filter.type = 'run';
  r.renderList();
  assert.deepEqual(playerOptionIds(r), []);
  assert.match(r.elements.get('player-choice').innerHTML, /disabled.*No players match these filters/);
  r.S.filter.type = '';
  r.S.filter.qtr = '';
  r.S.filter.airMin = 30;
  r.renderList();
  assert.deepEqual(playerOptionIds(r), ['hunter', 'lawrence', 'nflpro:202', 'smith']);
  r.S.filter.airMin = null;
  r.setAdvancedChoice('motion', 'false');
  assert.deepEqual(playerOptionIds(r), ['lawrence', 'q2-only', 'smith']);
  r.setAdvancedChoice('motion', '');
  r.S.filter.text = 'Second Quarter Corner';
  r.renderList();
  assert.deepEqual(playerOptionIds(r), ['lawrence', 'q2-only', 'smith']);
  r.S.filter.text = '';
  r.S.filter.offense = '';
  r.renderList();
  assert.ok(playerOptionIds(r).includes('henry'), 'clearing context restores the wider roster');
  assert.deepEqual(Array.from(r.S.mapping), mapping);
  assert.deepEqual(Array.from(r.S.plays, p => p.filmWeight), weights);
});

test('context changes keep selected tags removable, hide incompatible candidates and never silently broaden results', () => {
  const r = contextualPlayers();
  r.setAdvancedChoice('player', 'henry');
  assert.deepEqual(r.visible(), [0, 1]);
  r.S.filter.offense = 'JAX';
  r.renderList();
  assert.deepEqual(r.visible(), []);
  assert.deepEqual(playerOptionIds(r), []);
  assert.deepEqual(playerOptionGroups(r), []);
  assert.match(r.elements.get('player-choice').innerHTML, /disabled.*No players match these filters/);
  assert.doesNotMatch(r.elements.get('player-choice').innerHTML, /All players selected/);
  assert.match(r.elements.get('player-choice').innerHTML, /data-remove-player="henry"/);
  r.renderAdvancedFilters();
  assert.deepEqual(Array.from(r.S.filter.choices.player), ['henry']);
  r.removePlayerFilter('henry');
  assert.deepEqual(r.visible(), [2, 3]);
  r.setAdvancedChoice('player', 'hunter');
  assert.deepEqual(r.visible(), [2]);
  assert.ok(!playerOptionIds(r).includes('q2-only'), 'incompatible players are hidden after a selection');
  r.setAdvancedChoice('player', 'q2-only');
  assert.deepEqual(r.visible(), [], 'AND matching remains strict even for an impossible combination');
  r.removePlayerFilter('q2-only');
  assert.deepEqual(r.visible(), [2]);
  r.removePlayerFilter('hunter');
  assert.ok(playerOptionIds(r).includes('q2-only'), 'removing selections restores newly compatible players');
});

test('the player picker distinguishes all selected from no compatible candidates', () => {
  const r = contextualPlayers();
  r.S.filter.offense = 'JAX';
  for (const id of ['hunter', 'lawrence', 'nflpro:202', 'smith']) r.setAdvancedChoice('player', id);
  assert.deepEqual(r.visible(), [2]);
  assert.deepEqual(playerOptionIds(r), []);
  assert.match(r.elements.get('player-choice').innerHTML, /disabled.*No players match these filters/);
  r.S.filter.qtr = '1';
  r.renderList();
  assert.match(r.elements.get('player-choice').innerHTML, /disabled.*All players selected/);
  r.removePlayerFilter('hunter');
  assert.deepEqual(playerOptionIds(r), ['hunter']);
  r.S.filter.qtr = '2';
  r.renderList();
  assert.deepEqual(r.visible(), []);
  assert.deepEqual(playerOptionIds(r), []);
  assert.match(r.elements.get('player-choice').innerHTML, /disabled.*No players match these filters/);
  assert.match(r.elements.get('player-choice').innerHTML, /data-remove-player="nflpro:202"/);
});

test('automatic participation refresh updates scoped player options without clearing context or valid selected tags', async () => {
  const r = contextualPlayers();
  vm.runInContext('realign = renderInfo = setStatus = () => {};', r.context);
  r.S.game = { gameId: 'test', season: 2026 };
  r.S.filter.offense = 'JAX';
  r.setAdvancedChoice('player', 'smith');
  const incoming = structuredClone(r.S.plays);
  incoming[2].onField.defense.push({ sourceId: 'new-defender', name: 'New Ravens Defender', position: 'CB' });
  r.context.window.api = { getPlays: async () => ({ plays: incoming }) };
  await r.refreshParticipation(true);
  assert.ok(playerOptionIds(r).includes('nflpro:new-defender'));
  assert.equal(playerOptionCounts(r)['nflpro:new-defender'], 1);
  assert.equal(playerOptionCounts(r).lawrence, 2);
  assert.ok(!playerOptionIds(r).includes('henry'));
  assert.deepEqual(Array.from(r.S.filter.choices.player), ['smith']);
  assert.equal(r.S.filter.offense, 'JAX');
  assert.deepEqual(r.visible(), [2, 3]);
});

test('on-field details order both sides and clearly distinguish depth-chart inference and reported eligibility', () => {
  const r = renderer();
  const play = r.S.plays[0];
  play.onField = {
    offense: [
      { id: '00-1', position: 'T', number: '76', name: 'Eligible OL', eligibleReceiver: true },
      { id: '00-2', position: 'G', name: 'Left Guard', positionInference: { position: 'LG', source: '<Chart & source>', asOf: '2026-11-05' } },
      { id: '00-3', position: 'QB', name: 'Quarterback' },
      { id: '00-4', position: 'WR', name: 'Receiver' }, { id: '00-5', position: 'TE', name: 'Tight End' },
    ],
    defense: [{ position: 'SS', name: 'Safety' }, { position: 'DE', name: 'End' }, { position: 'CB', name: 'Corner' }],
  };
  r.S.curPlay = 0;
  r.renderInfo();
  const html = r.elements.get('on-field-lists').innerHTML;
  const names = ['Receiver', 'Tight End', 'Eligible OL', 'Quarterback', 'Left Guard'];
  for (let i = 1; i < names.length; i++) assert.ok(html.indexOf(`${names[i - 1]}</li>`) < html.indexOf(`${names[i]}</li>`));
  assert.ok(html.indexOf('</span>End') < html.indexOf('</span>Corner'));
  assert.ok(html.indexOf('</span>Corner') < html.indexOf('</span>Safety'));
  assert.match(html, />LG\*<\/span>/);
  assert.match(html, /&lt;Chart &amp; source&gt;, 2026-11-05/);
  assert.match(html, /listed G/);
  assert.match(html, /not confirmed snap alignment/);
  assert.match(html, />OL-E<\/span>#76 Eligible OL/);
  assert.match(html, /extra lineman explicitly reported eligible/);
  assert.equal(play.onField.offense[1].position, 'G');
});

test('player tags require all selected IDs across either side, deduplicate picks, and remove only the chosen player', () => {
  const r = renderer();
  const first = { id: '00-1', name: 'First Player', position: 'WR' };
  const second = { sourceId: '202', name: 'Second Player', position: 'CB' };
  r.S.plays[0].onField = { offense: [first], defense: [second] };
  r.S.plays[2].onField = { offense: [first], defense: [] };
  r.S.plays[3].onField = { offense: [], defense: [second] };
  r.derivePlays();
  const mapping = Array.from(r.S.mapping);
  const weights = Array.from(r.S.plays, (p) => p.filmWeight);
  r.renderAdvancedFilters();
  r.setAdvancedChoice('player', '00-1');
  r.setAdvancedChoice('player', 'nflpro:202');
  r.setAdvancedChoice('player', '00-1');
  assert.deepEqual(Array.from(r.S.filter.choices.player), ['00-1', 'nflpro:202']);
  assert.deepEqual(r.visible(), [0]);
  assert.match(r.elements.get('adv-filter-active').textContent, /2 active/);
  const html = r.elements.get('player-choice').innerHTML;
  assert.match(html, /Match all selected players/);
  assert.match(html, /data-remove-player="00-1"/);
  assert.match(html, /aria-label="Remove Second Player from on-field filter"/);
  assert.doesNotMatch(html, /<option value="00-1"/);
  assert.match(html, /All players selected/);
  r.S.filter.type = 'pass';
  r.S.filter.offense = 'BAL';
  r.renderList();
  assert.deepEqual(r.visible(), [0]);
  r.removePlayerFilter('00-1');
  assert.deepEqual(Array.from(r.S.filter.choices.player), ['nflpro:202']);
  assert.deepEqual(r.visible(), [0, 3]);
  assert.match(r.elements.get('player-choice').innerHTML, /<option value="00-1"/);
  r.removePlayerFilter('nflpro:202');
  assert.equal(r.S.filter.choices.player, undefined);
  assert.deepEqual(r.visible(), [0, 3, 4]);
  assert.equal(r.elements.get('adv-filter-active').hidden, true);
  assert.deepEqual(Array.from(r.S.mapping), mapping);
  assert.deepEqual(Array.from(r.S.plays, (p) => p.filmWeight), weights);
});

test('player tags retain available selections across rerenders and discard unavailable players without clearing other filters', () => {
  const r = renderer();
  const first = { id: '00-1', name: '<First & Player>', position: 'WR' };
  const second = { id: '00-2', name: 'Second Player', position: 'TE' };
  r.S.plays[0].onField = { offense: [first, second], defense: [] };
  r.S.filter.choices = { player: ['00-1', '00-2'], down: '2' };
  r.S.plays[0].down = 2;
  r.renderAdvancedFilters();
  assert.deepEqual(Array.from(r.S.filter.choices.player), ['00-1', '00-2']);
  assert.equal(r.S.filter.choices.down, '2');
  assert.match(r.elements.get('player-choice').innerHTML, /&lt;First &amp; Player&gt;/);
  assert.doesNotMatch(r.elements.get('player-choice').innerHTML, /<First & Player>/);
  r.S.plays[0].onField.offense = [first];
  r.renderAdvancedFilters();
  assert.deepEqual(Array.from(r.S.filter.choices.player), ['00-1']);
  assert.equal(r.S.filter.choices.down, '2');
  delete r.S.plays[0].onField;
  r.renderAdvancedFilters();
  assert.equal(r.S.filter.choices.player, undefined);
  assert.equal(r.S.filter.choices.down, '2');
  assert.doesNotMatch(r.elements.get('player-choice').innerHTML, /data-remove-player/);
});

test('persistent participation indicator shows watching, imported counts, automatic updates, and warnings', () => {
  const r = renderer();
  r.S.game = { gameId: 'test' };
  r.S.settings.participationRoot = '/configured-import-folder';
  r.renderList();
  assert.equal(r.elements.get('participation-status').hidden, false);
  assert.match(r.elements.get('participation-summary').textContent, /no matching plays/);
  assert.match(r.elements.get('participation-notice').textContent, /No manual refresh needed/);
  r.S.plays[0].participation = { source: 'NFL Pro', status: 'complete' };
  r.S.plays[1].participation = { source: 'NFL Pro', status: 'partial' };
  r.S.participationNotice = 'Updated automatically at 11:03 AM.';
  r.renderList();
  assert.match(r.elements.get('participation-summary').textContent, /2 plays imported.*1 complete, 1 partial/);
  assert.match(r.elements.get('participation-notice').textContent, /Updated automatically/);
  r.S.filter.offense = 'BUF';
  r.renderList();
  assert.deepEqual(r.visible(), [2]);
  assert.match(r.elements.get('participation-summary').textContent, /2 plays imported/);
  r.S.participationWarning = 'One source play could not be matched.';
  r.renderList();
  assert.match(r.elements.get('participation-notice').textContent, /Data warning: One source play/);
  r.S.game = null;
  r.renderList();
  assert.equal(r.elements.get('participation-status').hidden, true);
  r.S.game = { gameId: 'another-game' };
  r.S.settings.participationRoot = '';
  r.S.plays.forEach((p) => { delete p.participation; });
  r.renderList();
  assert.equal(r.elements.get('participation-status').hidden, true);
});

test('automatic refresh distinguishes participation changes from unrelated folder events and preserves selection', async () => {
  const r = renderer();
  vm.runInContext('realign = renderInfo = setStatus = () => {};', r.context);
  r.S.game = { gameId: 'test', season: 2024 };
  r.S.settings.participationRoot = '/configured-import-folder';
  r.S.curPlay = 2;
  r.S.selected = new Set([1, 2]);
  const incoming = r.S.plays.map((p, i) => ({
    ...p, ...(i === 0 ? { participation: { source: 'NFL Pro', status: 'complete' } } : {}),
  })).reverse();
  r.context.window.api = { getPlays: async () => ({ plays: incoming }) };
  await r.refreshParticipation(true);
  assert.match(r.elements.get('participation-summary').textContent, /1 play imported/);
  assert.match(r.elements.get('participation-notice').textContent, /Updated automatically at/);
  assert.equal(r.S.plays[r.S.curPlay].playId, 3);
  assert.deepEqual(Array.from(r.S.selected, (i) => r.S.plays[i].playId).sort(), [2, 3]);
  await r.refreshParticipation(true);
  assert.match(r.elements.get('participation-notice').textContent, /Checked automatically at/);
  r.context.window.api.getPlays = async () => ({ plays: incoming.map(({ participation, ...p }) => p) });
  await r.refreshParticipation(true);
  assert.match(r.elements.get('participation-summary').textContent, /no matching plays/);
  assert.match(r.elements.get('participation-notice').textContent, /Updated automatically at/);
  r.context.window.api.getPlays = async () => { throw new Error('Import folder unreadable'); };
  await r.refreshParticipation(true);
  assert.match(r.elements.get('participation-notice').textContent, /Data warning: Import folder unreadable/);
});

test('single-play export names retain game numbering and selected-team possession through Share', async () => {
  const r = renderer();
  vm.runInContext(`
    clearTimeout = pause = toggleOverlay = renderThemeOptions = renderPositionOptions =
      updatePositionControls = selectTrimPlay = updateExportOptions = updateThemeControls =
      updateReportOptions = () => {};
    currentOverlayAppearance = () => ({});
    globalThis.openShare = openShare;
    globalThis.exportSelection = exportSelection;
  `, r.context);
  r.S.settings = { ...settings.DEFAULT_SETTINGS, defaultTeam: 'BUF' };
  r.S.sel.team = 'BAL';
  r.S.film = { path: '/film.mp4', info: { fps: 30 } };
  r.S.pairs = Array.from({ length: 5 }, () => ({
    sideline: { start: 1, end: 3 }, endzone: { start: 4, end: 6 },
  }));
  r.S.plays[2].defteam = 'BAL';
  r.S.plays[4].playType = 'punt';
  r.derivePlays();
  const el = (id) => r.context.document.getElementById(id);
  el('share-angle').value = 'sideline';
  el('share-clean').checked = true;
  const requests = [];
  r.context.window.api = { exportClips: async (request) => {
    requests.push(request);
    return { cancelled: true };
  } };
  for (const [index, possession] of [[2, 'D'], [3, 'O'], [4, 'ST']]) {
    r.S.selected = new Set([index]);
    r.S.visible = [index];
    r.S.plays[index].down = 2;
    r.S.plays[index].ydstogo = 7;
    r.S.plays[index].playId = 1000 + index;
    r.context.openShare();
    assert.equal(r.S.exportDraft.clips[0].playNumber, index + 1);
    el('share-report-format').value = 'none';
    await r.context.exportSelection();
    assert.equal(requests.at(-1)?.suggestedName, `BAL-${possession}-${index + 1}-2-7.mp4`);
    assert.equal('playNumber' in requests.at(-1).clips[0], false);
  }
});

test('update notes render as text and automatic checks do not interrupt playback or another dialog', async () => {
  const r = renderer();
  const result = {
    status: 'available', currentVersion: '0.2.3', notify: true,
    release: { version: '0.2.4', notes: '<img src=x onerror=alert(1)> release notes' },
  };
  r.context.window.api = { checkUpdates: async () => result, dismissUpdate: async () => {} };
  r.context.document.querySelectorAll = () => [];
  r.renderUpdate(result);
  const modal = r.elements.get('updates') || r.context.document.getElementById('updates');
  modal.showModal = () => { modal.open = true; };
  modal.close = () => { modal.open = false; };
  assert.equal(r.elements.get('updates-notes').textContent, result.release.notes);
  assert.equal(r.elements.get('updates-notes').innerHTML, '');
  r.S.playing = true;
  await r.checkUpdates(true);
  assert.ok(!modal.open);
  assert.equal(r.elements.get('btn-update').hidden, false);
  r.S.playing = false;
  r.context.document.querySelectorAll = () => [{ hidden: false }];
  await r.checkUpdates(true);
  assert.ok(!modal.open);
  await r.checkUpdates(false);
  assert.equal(modal.open, true, 'manual checks may open over Settings');
  r.handleKeydown({ key: ' ', target: {} });
  assert.equal(r.S.playing, false, 'film shortcuts are blocked while the update dialog is open');
  await r.closeUpdate();
  assert.equal(modal.open, false);
});

test('film setup occupies the empty viewer and becomes an optional panel after analysis', () => {
  const r = renderer();
  const el = (id) => r.context.document.getElementById(id);
  r.renderFilmSetup();
  assert.equal(el('film-setup').hidden, false);
  assert.equal(el('film-setup-toggle').hidden, true);
  assert.equal(el('film-setup-close').hidden, true);
  r.S.film = {};
  r.S.pairs = [{}];
  r.renderFilmSetup();
  assert.equal(el('film-setup').hidden, true);
  assert.equal(el('film-setup-toggle').hidden, false);
  r.S.filmSetupOpen = true;
  el('message').innerHTML = '<div>Choose the missing film.</div>';
  r.renderFilmSetup();
  assert.equal(el('film-setup').hidden, false);
  assert.equal(el('film-setup-close').hidden, false);
  assert.equal(el('message').hidden, true);
  assert.equal(el('film-setup-message').innerHTML, '<div>Choose the missing film.</div>');
  r.S.filmSetupOpen = false;
  r.S.analyzing = {};
  r.renderFilmSetup();
  assert.equal(el('film-setup').hidden, false, 'analysis progress stays in the viewer panel');
  assert.equal(el('film-setup-close').hidden, true);
  r.S.analyzing = false;
  r.renderFilmSetup();
  assert.equal(el('film-setup').hidden, true);
  assert.equal(el('message').hidden, false);
});

test('update errors remain visible, offer retry, and leave controls enabled', async () => {
  const r = renderer();
  r.context.window.api = { checkUpdates: async () => { throw new Error('Offline'); } };
  const modal = r.context.document.getElementById('updates');
  modal.showModal = () => { modal.open = true; };
  await r.checkUpdates();
  assert.equal(modal.open, true);
  assert.match(r.elements.get('updates-summary').textContent, /Offline/);
  assert.equal(r.elements.get('updates-retry').hidden, false);
  assert.equal(r.elements.get('updates-download').hidden, true);
  assert.equal(r.elements.get('check-updates').disabled, false);
  assert.equal(r.elements.get('updates-retry').disabled, false);
});

test('angle pop-outs require analyzed film and report a refused window without hiding the player', () => {
  const r = renderer();
  r.updateAngleButtons();
  assert.equal(r.elements.get('pop-a').disabled, true);
  assert.equal(r.elements.get('pop-b').disabled, true);
  r.popAngle('a');
  r.S.film = { url: 'file:///film.mp4' };
  r.updateAngleButtons();
  assert.equal(r.elements.get('pop-a').disabled, true);
  r.popAngle('b');
  r.S.pairs = [{}];
  r.updateAngleButtons();
  assert.equal(r.elements.get('pop-a').disabled, false);
  assert.equal(r.elements.get('pop-b').disabled, false);
  r.popAngle('a');
  assert.match(r.elements.get('message').innerHTML, /Could not open the angle window/);
  assert.equal(r.elements.get('pop-a').disabled, false);
});

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

test('yardage and distance bounds apply to scrimmage plays and combine with advanced select filters', () => {
  const r = renderer();
  const rows = [
    { play_type: 'run', rush: '1', yards_gained: '12', down: '1', ydstogo: '10' },
    { play_type: 'pass', pass: '1', yards_gained: '0', down: '3', ydstogo: '7' },
    { play_type: 'pass', pass: '1', yards_gained: '25', down: '3', ydstogo: '2' },
    { play_type: 'kickoff', yards_gained: '0' },
    { play_type: 'no_play', pass: '1', yards_gained: '0', down: '2', ydstogo: '15', penalty: '1' },
  ];
  r.S.plays = rows.map((row, i) => plays.normalizePlay({ play_id: String(i + 1), desc: 'play', yrdln: 'BAL 25', posteam: 'BAL', fixed_drive: '1', ...row }));
  advanced.attach(r.S.plays[0], { offense_personnel: '2 RB, 1 TE, 2 WR', defense_personnel: '4 DL, 3 LB, 4 DB' }, { qb_location: 'U', n_defense_box: '8', is_motion: 'TRUE' });
  advanced.attach(r.S.plays[1], { offense_personnel: '1 RB, 1 TE, 3 WR', defense_personnel: '4 DL, 1 LB, 6 DB', defense_coverage_type: 'COVER_3' }, { qb_location: 'S', n_defense_box: '6', is_motion: 'FALSE', n_pass_rushers: '5', n_blitzers: '1' });
  advanced.attach(r.S.plays[2], { offense_personnel: '1 RB, 1 TE, 3 WR', defense_personnel: '4 DL, 2 LB, 5 DB' }, { qb_location: 'S', n_defense_box: '6', is_motion: 'TRUE', n_pass_rushers: '4', n_blitzers: '0' });
  r.S.mapping = r.S.plays.map(() => null);
  r.derivePlays();
  r.renderAdvancedFilters();
  const filters = r.elements.get('adv-choices').innerHTML;
  for (const label of ['Down', 'Off. personnel', 'Def. package', 'Box count', 'Blitzers', 'Motion', 'Coverage']) assert.ok(filters.includes(`>${label}<`), label);
  assert.ok(!filters.includes('>RPO<'), 'filters without data are hidden');
  assert.ok(filters.indexOf('>4-3<') < filters.indexOf('>Nickel<') && filters.indexOf('>Nickel<') < filters.indexOf('>Dime<'));
  assert.equal(r.elements.get('adv-note').hidden, true);

  const visible = (patch) => {
    Object.assign(r.S.filter, { yardsMin: null, yardsMax: null, distMin: null, distMax: null, choices: {} }, patch);
    r.renderList();
    return r.visible();
  };
  assert.deepEqual(visible({}), [0, 1, 2, 3, 4]);
  assert.deepEqual(visible({ yardsMin: 0 }), [0, 1, 2], 'kickoffs and no-plays have no yards gained');
  assert.deepEqual(visible({ yardsMin: 10, yardsMax: 20 }), [0]);
  assert.deepEqual(visible({ distMax: 7 }), [1, 2]);
  assert.deepEqual(visible({ choices: { down: '3' } }), [1, 2]);
  assert.deepEqual(visible({ choices: { offPersonnel: '11' } }), [1, 2]);
  assert.deepEqual(visible({ choices: { defPackage: '4-3' } }), [0]);
  assert.deepEqual(visible({ choices: { box: '8+' } }), [0]);
  assert.deepEqual(visible({ choices: { box: '<=5' } }), []);
  assert.deepEqual(visible({ choices: { blitzers: '1+' } }), [1]);
  assert.deepEqual(visible({ choices: { motion: 'false' } }), [1]);
  assert.deepEqual(visible({ choices: { motion: 'true', offPersonnel: '11' } }), [2]);
  assert.deepEqual(visible({ yardsMin: 1, choices: { qbLocation: 'Shotgun' } }), [2]);
  assert.deepEqual(visible({ choices: { coverage: 'Cover 3' } }), [1]);
  r.S.filter.text = 'nickel';
  assert.deepEqual(visible({}), [2], 'search covers personnel tags');
  r.S.filter.text = '';

  assert.ok(r.elements.get('play-list').innerHTML.includes('11 v Nickel'));
  r.S.filter.choices = { rpo: 'true', coverage: 'Cover 3' };
  r.renderAdvancedFilters();
  assert.deepEqual({ ...r.S.filter.choices }, { coverage: 'Cover 3' }, 'selections unavailable in the loaded game are cleared');
});
