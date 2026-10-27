(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).settings = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACTIONS = [
    { id: 'playPause', label: 'Play / pause', keys: ['Space', 'K'] },
    { id: 'frameForward', label: 'Forward 1 frame', keys: ['ArrowRight', '.'] },
    { id: 'frameBack', label: 'Back 1 frame', keys: ['ArrowLeft', ','] },
    { id: 'jumpForward', label: 'Forward N frames', keys: ['Shift+ArrowRight'] },
    { id: 'jumpBack', label: 'Back N frames', keys: ['Shift+ArrowLeft'] },
    { id: 'nextPlay', label: 'Next play', keys: ['ArrowDown', 'N'] },
    { id: 'prevPlay', label: 'Previous play', keys: ['ArrowUp', 'P'] },
    { id: 'restartPlay', label: 'Restart play', keys: ['R', 'Home'] },
    { id: 'cycleSpeed', label: 'Cycle slow-motion speed', keys: ['S'] },
    { id: 'toggleEnd', label: 'Toggle end-of-play behaviour (stop / auto-advance / loop)', keys: ['E'] },
    { id: 'nudgeBack', label: 'Sync: end zone 1 frame earlier', keys: ['['] },
    { id: 'nudgeForward', label: 'Sync: end zone 1 frame later', keys: [']'] },
    { id: 'nudgeReset', label: 'Sync: reset offset', keys: ['\\'] },
    { id: 'nextClip', label: 'Browse film: next clip pair', keys: ['Shift+ArrowDown'] },
    { id: 'prevClip', label: 'Browse film: previous clip pair', keys: ['Shift+ArrowUp'] },
    { id: 'linkClip', label: 'Fix: link shown clip to selected play', keys: ['Shift+L'] },
    { id: 'markNoFilm', label: 'Fix: mark selected play as no film', keys: ['Shift+X'] },
    { id: 'clearFix', label: 'Fix: clear correction on selected play', keys: ['Shift+C'] },
    { id: 'search', label: 'Search plays', keys: ['/'] },
    { id: 'help', label: 'Show / hide shortcuts', keys: ['?'] },
  ];

  const DEFAULT_SETTINGS = {
    jumpFrames: 10,
    endOfPlay: 'stop', // 'stop' | 'advance' | 'loop'
    speeds: [1, 0.5, 0.25],
    defaultTeam: 'BAL',
    filmRoot: '',
    autoAnalyze: true,
    cutThreshold: 0.1,
    skipNoFilm: true,
    keyPlays: {
      turnovers: true,
      scores: true,
      runYards: 10,
      passYards: 20,
      sacks: false,
      fourthDownConversions: true,
      lossYards: 3,
    },
    shortcuts: Object.fromEntries(ACTIONS.map((a) => [a.id, a.keys.slice()])),
  };

  function mergeSettings(saved) {
    const s = saved || {};
    const out = Object.assign({}, DEFAULT_SETTINGS, s);
    out.keyPlays = Object.assign({}, DEFAULT_SETTINGS.keyPlays, s.keyPlays || {});
    out.shortcuts = {};
    for (const a of ACTIONS) {
      const v = s.shortcuts && s.shortcuts[a.id];
      out.shortcuts[a.id] = Array.isArray(v) ? v.slice() : a.keys.slice();
    }
    const jf = Math.round(Number(out.jumpFrames));
    out.jumpFrames = jf >= 1 && jf <= 600 ? jf : DEFAULT_SETTINGS.jumpFrames;
    if (!['stop', 'advance', 'loop'].includes(out.endOfPlay)) out.endOfPlay = 'stop';
    if (!Array.isArray(out.speeds) || !out.speeds.length || out.speeds.some((x) => !(x > 0 && x <= 4))) out.speeds = DEFAULT_SETTINGS.speeds.slice();
    return out;
  }

  /** Converts a KeyboardEvent to a combo string like "Shift+ArrowRight", "K", "[" or "?". */
  function comboFromEvent(e) {
    let key = e.key;
    if (key === ' ' || key === 'Spacebar') key = 'Space';
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified'].includes(key)) return null;
    const single = key.length === 1;
    const letter = single && /[a-z]/i.test(key);
    if (single) key = key.toUpperCase();
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Meta');
    if (e.shiftKey && (letter || !single)) parts.push('Shift');
    parts.push(key);
    return parts.join('+');
  }

  const PRETTY = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Meta: '⌘' };
  function keyLabel(combo) {
    return combo.split('+').map((p) => PRETTY[p] || p).join(' + ');
  }

  function buildKeymap(shortcuts) {
    const map = new Map();
    for (const [id, keys] of Object.entries(shortcuts)) for (const k of keys) map.set(k, id);
    return map;
  }

  return { ACTIONS, DEFAULT_SETTINGS, mergeSettings, comboFromEvent, keyLabel, buildKeymap };
});
