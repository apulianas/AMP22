'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const overlay = require('../src/shared/overlay');
const teams = require('../src/shared/teams');
const { mergeSettings } = require('../src/shared/settings');

test('every team has a distinct dark team panel and highly contrasting text', () => {
  for (const team of Object.keys(teams.TEAMS)) {
    const appearance = overlay.appearance(null, 0.9, team);
    assert.deepEqual(overlay.theme(appearance), overlay.teamTheme(team));
    assert.equal(appearance.accent, teams.COLORS[team][1]);
    const bg = overlay.luminance(appearance.background);
    const fg = overlay.luminance(appearance.text);
    assert.ok((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 7, team);
    assert.ok(bg < 0.1, `${team} panel must stay dark against turf`);
  }
  assert.deepEqual(overlay.teamTheme('OAK'), overlay.teamTheme('LV'));
  assert.deepEqual(overlay.teamTheme('SD'), overlay.teamTheme('LAC'));
  assert.deepEqual(overlay.teamTheme('STL'), overlay.teamTheme('LA'));
  assert.notDeepEqual(overlay.teamTheme('BAL'), overlay.teamTheme('CIN'));
  assert.doesNotThrow(() => overlay.appearance(null, 1, 'unknown'));
});

test('custom backgrounds automatically choose accessible text, with an opposite outline at all opacities', () => {
  for (const background of ['#ffffff', '#000000', '#808080', '#00ff00', '#123456', '#ffff00']) {
    for (const alpha of [0, 0.25, 0.9, 1]) {
      const appearance = overlay.appearance({ background, accent: '#FF8000' }, alpha);
      assert.equal(appearance.opacity, alpha);
      assert.notEqual(appearance.text, appearance.outline);
      const bg = overlay.luminance(background);
      const fg = overlay.luminance(appearance.text);
      assert.ok((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5);
      assert.equal(appearance.accent, '#ff8000');
    }
  }
  for (const alpha of [-1, 1.01, NaN, Infinity, '0.5', null]) assert.throws(() => overlay.opacity(alpha), /opacity/);
  for (const theme of [null, {}, { background: 'red', accent: '#ffffff' }, { background: '#ffffff', accent: '#fff' }]) {
    assert.throws(() => overlay.theme(theme), /colors/);
  }
});

test('theme preferences round-trip independently, sanitize saved data, and preserve automatic selection and zero opacity', () => {
  const theme = { background: '#123456', accent: '#abcdef' };
  const saved = mergeSettings({ overlayTheme: theme, overlayOpacity: 0, overlayThemes: [{ name: ' Custom ', ...theme }] });
  const restored = mergeSettings(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.overlayTheme, theme);
  assert.equal(restored.overlayOpacity, 0);
  assert.deepEqual(restored.overlayThemes, [{ name: 'Custom', ...theme }]);
  saved.overlayTheme.background = '#ffffff';
  assert.equal(theme.background, '#123456');
  assert.equal(mergeSettings({}).overlayTheme, null);
  assert.equal(mergeSettings({ overlayTheme: {} }).overlayTheme, null);
  for (const overlayOpacity of [-1, 2, NaN, '0.5', null]) {
    assert.equal(mergeSettings({ overlayOpacity }).overlayOpacity, overlay.DEFAULT_OPACITY);
  }
  assert.deepEqual(mergeSettings({ overlayThemes: [
    { name: '', ...theme }, { name: 'x'.repeat(61), ...theme }, { name: 'Bad' },
    { name: 'Custom', ...theme }, { name: 'Custom', ...theme }, null,
  ] }).overlayThemes, [{ name: 'Custom', ...theme }]);
});
