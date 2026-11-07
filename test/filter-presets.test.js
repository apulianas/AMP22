'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const presets = require('../src/shared/filter-presets');
const { mergeSettings } = require('../src/shared/settings');

test('presets round-trip all filters with relative analyzed-team and opponent offenses', () => {
  const filter = {
    ...presets.emptyFilter(), type: 'pass', offense: 'BAL', text: 'screen', qtr: '2', result: 'firstdown',
    airMin: -5, airMax: 0, yardsMin: 0, yardsMax: 20, distMin: 0, distMax: 10,
    choices: { down: '3', offPersonnel: '11', box: '8+', motion: 'false' },
  };
  const saved = presets.capture(' Third down ', filter, 'BAL', 'JAX');
  assert.equal(saved.filter.offense, 'analyzed');
  assert.equal(saved.name, 'Third down');
  const settings = mergeSettings(JSON.parse(JSON.stringify({ filterPresets: [saved] })));
  assert.deepEqual(settings.filterPresets, [saved]);
  assert.deepEqual(presets.restore(settings.filterPresets[0], 'KC', 'DEN'), { ...filter, offense: 'KC' });
  const opposing = presets.capture('Opponent', { ...filter, offense: 'JAX' }, 'BAL', 'JAX');
  assert.equal(presets.restore(opposing, 'KC', 'DEN').offense, 'DEN');
  assert.equal(presets.restore(presets.capture('Both', { ...filter, offense: '' }, 'BAL', 'JAX'), 'KC', 'DEN').offense, '');
  settings.filterPresets[0].filter.choices.down = '1';
  assert.equal(filter.choices.down, '3');
  assert.equal(saved.filter.choices.down, '3');
});

test('player presets are tied to the analyzed team and cross-team use requires explicitly omitting all players', () => {
  const filter = { ...presets.emptyFilter(), offense: 'BAL', choices: { player: ['ravens-player', 'opponent-player'], down: '2' } };
  const saved = presets.capture('Players', filter, 'BAL', 'JAX', { 'ravens-player': 'Raven' });
  assert.equal(saved.playerTeam, 'BAL');
  assert.deepEqual(presets.restore(saved, 'BAL', 'CIN').choices.player, filter.choices.player);
  assert.throws(() => presets.restore(saved, 'KC', 'DEN'), /tied to BAL/);
  const without = presets.restore(saved, 'KC', 'DEN', true);
  assert.deepEqual(without.choices, { down: '2' });
  assert.equal(without.offense, 'KC');
  assert.equal(saved.filter.choices.player.length, 2);
  assert.notEqual(without.choices, saved.filter.choices);
});

test('saved presets reject malformed data and duplicate names without sharing mutable defaults', () => {
  const good = presets.capture('A', presets.emptyFilter(), 'BAL', 'JAX');
  const invalid = [
    null, {}, { ...good, name: '' }, { ...good, name: 'x'.repeat(61) },
    { ...good, filter: { ...good.filter, offense: 'BAL' } },
    { ...good, filter: { ...good.filter, type: 'invalid' } },
    { ...good, filter: { ...good.filter, airMin: '0' } },
    { ...good, filter: { ...good.filter, airMax: Infinity } },
    { ...good, filter: { ...good.filter, qtr: {} } },
    { ...good, filter: { ...good.filter, choices: { player: 'id' } } },
    { ...good, filter: { ...good.filter, choices: { player: ['id'] } }, playerTeam: '' },
    { ...good, filter: { ...good.filter, choices: { motion: true } } },
  ];
  assert.deepEqual(mergeSettings({ filterPresets: [...invalid, good, { ...good, name: 'a' }] }).filterPresets, [good]);
  assert.throws(() => presets.capture('Bad team', { ...presets.emptyFilter(), offense: 'BUF' }, 'BAL', 'JAX'), /Invalid preset/);
  const first = mergeSettings({});
  first.filterPresets.push(good);
  assert.deepEqual(mergeSettings({}).filterPresets, []);
});
