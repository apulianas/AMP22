'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/shared/settings');

const ev = (key, mods = {}) => Object.assign({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }, mods);

test('comboFromEvent normalizes keys', () => {
  assert.equal(s.comboFromEvent(ev(' ')), 'Space');
  assert.equal(s.comboFromEvent(ev('k')), 'K');
  assert.equal(s.comboFromEvent(ev('L', { shiftKey: true })), 'Shift+L');
  assert.equal(s.comboFromEvent(ev('ArrowRight', { shiftKey: true })), 'Shift+ArrowRight');
  assert.equal(s.comboFromEvent(ev('?', { shiftKey: true })), '?');
  assert.equal(s.comboFromEvent(ev('Shift', { shiftKey: true })), null);
});

test('default keymap covers the required actions', () => {
  const km = s.buildKeymap(s.DEFAULT_SETTINGS.shortcuts);
  assert.equal(km.get('ArrowRight'), 'frameForward');
  assert.equal(km.get('ArrowLeft'), 'frameBack');
  assert.equal(km.get('Shift+ArrowRight'), 'jumpForward');
  assert.equal(km.get('Shift+ArrowLeft'), 'jumpBack');
  assert.equal(km.get('ArrowDown'), 'nextPlay');
  assert.equal(km.get('ArrowUp'), 'prevPlay');
  assert.equal(km.get('Space'), 'playPause');
  assert.equal(s.DEFAULT_SETTINGS.jumpFrames, 10);
});

test('mergeSettings validates and fills defaults', () => {
  const m = s.mergeSettings({ jumpFrames: '5', endOfPlay: 'bogus', speeds: [], keyPlays: { runYards: 15 }, shortcuts: { nextPlay: ['J'] } });
  assert.equal(m.jumpFrames, 5);
  assert.equal(m.endOfPlay, 'stop');
  assert.deepEqual(m.speeds, [1, 0.5, 0.25]);
  assert.equal(m.keyPlays.runYards, 15);
  assert.equal(m.keyPlays.passYards, 20);
  assert.deepEqual(m.shortcuts.nextPlay, ['J']);
  assert.deepEqual(m.shortcuts.prevPlay, ['ArrowUp', 'P']);
  assert.equal(s.mergeSettings({ jumpFrames: 0 }).jumpFrames, 10);
});
