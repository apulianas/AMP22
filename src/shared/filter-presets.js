(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).filterPresets = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHOICES = ['down', 'player', 'offPersonnel', 'defPackage', 'qbLocation', 'formation',
    'backfield', 'box', 'rushers', 'blitzers', 'motion', 'playAction', 'rpo', 'screen', 'noHuddle', 'coverage', 'manZone',
    'blitz', 'pressure', 'boxCategory', 'defPersonnelGroup'];
  const RANGES = ['airMin', 'airMax', 'yardsMin', 'yardsMax', 'distMin', 'distMax'];
  const RESULTS = ['', 'key', 'negative', 'sack', 'turnover', 'score', 'big', 'firstdown', 'penalty'];

  function emptyFilter() {
    return {
      type: 'all', text: '', offense: '', qtr: '', result: '',
      ...Object.fromEntries(RANGES.map(key => [key, null])), choices: {},
    };
  }

  function normalizePreset(value) {
    if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60) {
      throw new Error('Enter a preset name of 1-60 characters.');
    }
    const source = value.filter;
    if (!source || !['all', 'run', 'pass', 'special'].includes(source.type) ||
        typeof source.text !== 'string' || !['', 'analyzed', 'opponent'].includes(source.offense) ||
        typeof source.qtr !== 'string' || !/^(?:[1-9]\d*)?$/.test(source.qtr) || !RESULTS.includes(source.result) ||
        !source.choices || typeof source.choices !== 'object' || Array.isArray(source.choices)) {
      throw new Error('Invalid preset filters.');
    }
    const filter = { ...emptyFilter(), type: source.type, text: source.text, offense: source.offense, qtr: source.qtr, result: source.result };
    for (const key of RANGES) {
      const n = source[key];
      if (n != null && !Number.isFinite(n)) throw new Error('Preset bounds must be finite numbers.');
      filter[key] = n ?? null;
    }
    for (const key of CHOICES) {
      const option = source.choices[key];
      if (option == null || option === '') continue;
      if (key === 'player') {
        if (!Array.isArray(option) || option.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid preset players.');
        if (option.length) filter.choices.player = [...new Set(option)];
      } else {
        if (typeof option !== 'string' || option.length > 100) throw new Error('Invalid preset choice.');
        filter.choices[key] = option;
      }
    }
    const players = filter.choices.player || [];
    if (players.length && (typeof value.playerTeam !== 'string' || !/^[A-Z]{2,3}$/.test(value.playerTeam))) {
      throw new Error('Player presets require an analyzed team.');
    }
    return {
      name: value.name.trim(), filter, playerTeam: players.length ? value.playerTeam : '',
      playerNames: Object.fromEntries(players.map(id => [id, typeof value.playerNames?.[id] === 'string' ? value.playerNames[id] : id])),
    };
  }

  function capture(name, filter, team, opponent, playerNames) {
    const offense = !filter.offense ? '' : filter.offense === team ? 'analyzed' : filter.offense === opponent ? 'opponent' : null;
    return normalizePreset({ name, filter: { ...filter, offense }, playerTeam: team, playerNames });
  }

  function restore(preset, team, opponent, withoutPlayers = false) {
    const saved = normalizePreset(preset);
    if (saved.playerTeam && saved.playerTeam !== team && !withoutPlayers) {
      throw new Error(`This preset's players are tied to ${saved.playerTeam}. Apply without players for ${team}.`);
    }
    const filter = saved.filter;
    if (filter.offense && !(filter.offense === 'analyzed' ? team : opponent)) throw new Error('Load a game before applying a team filter.');
    filter.offense = filter.offense === 'analyzed' ? team : filter.offense === 'opponent' ? opponent : '';
    if (withoutPlayers) delete filter.choices.player;
    return filter;
  }

  function savedPresets(value) {
    const out = [];
    for (const item of Array.isArray(value) ? value : []) {
      try {
        const preset = normalizePreset(item);
        if (!out.some(p => p.name.toLowerCase() === preset.name.toLowerCase())) out.push(preset);
      } catch { /* Ignore malformed saved preferences, as with other named settings. */ }
    }
    return out;
  }

  return { emptyFilter, normalizePreset, capture, restore, savedPresets };
});
