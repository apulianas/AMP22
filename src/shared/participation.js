(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.AMP22Participation = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLUMNS = [
    'schema_version', 'season', 'season_type', 'week', 'away_team', 'home_team',
    'source_game_id', 'source_play_id', 'quarter', 'clock', 'down', 'yards_to_go',
    'description', 'side', 'team', 'source_player_id', 'gsis_id', 'name',
    'jersey_number', 'position', 'captured_at',
  ];
  const ID = /^[a-zA-Z0-9-]{1,80}$/;
  const TEAM = /^[A-Z]{2,3}$/;
  const DIAGNOSTIC_FIELDS = [
    'schema_version', 'season', 'season_type', 'week', 'away_team', 'home_team',
    'quarter', 'clock', 'down', 'yards_to_go', 'side', 'team', 'jersey_number', 'position', 'captured_at',
  ];

  function validationValue(field, value) {
    if (typeof value === 'string') {
      if (/^\[(?:string length \d+|undefined|object|number|boolean)\]$/.test(value)) return value;
      if (DIAGNOSTIC_FIELDS.includes(field) && value.length <= 40 && /^[\x20-\x7e]*$/.test(value)) return value;
      return `[string length ${value.length}]`;
    }
    return `[${typeof value}]`;
  }

  function invalidField(field, value, row, index) {
    const detail = { field, value: validationValue(field, value), row: index + 1,
      source_play_id: typeof row.source_play_id === 'string' && ID.test(row.source_play_id) ? row.source_play_id : '' };
    const error = new Error(`Invalid participation ${field}: ${JSON.stringify(detail.value)} (play ${detail.source_play_id || 'unknown'}, row ${detail.row}).`);
    error.name = 'ParticipationValidationError';
    error.code = 'INVALID_PARTICIPATION_FIELD';
    error.detail = detail;
    return error;
  }

  function csv(rows) {
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^\s*[=+\-@]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    return '\ufeff' + [COLUMNS.map(cell).join(','), ...rows.map((r) =>
      COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
  }

  function validate(rows, header = COLUMNS) {
    if (COLUMNS.some((c) => !header.includes(c)) || new Set(header).size !== header.length) {
      throw new Error('Unsupported participation CSV columns.');
    }
    if (!rows.length || rows.length > 30000) throw new Error('Participation CSV must contain 1–30000 player rows.');
    const plays = new Map();
    let gameKey;
    for (const [index, r] of rows.entries()) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`Invalid participation row ${index + 1}.`);
      for (const field of COLUMNS) {
        if (typeof r[field] !== 'string' || r[field].length > (field === 'description' ? 3000 : 200)) {
          throw invalidField(field, r[field], r, index);
        }
      }
      const checks = [
        ['schema_version', r.schema_version === '1'],
        ['season', /^\d{4}$/.test(r.season)],
        ['season_type', ['REG', 'POST', 'PRE'].includes(r.season_type)],
        ['week', /^\d{1,2}$/.test(r.week) && Number(r.week) >= 1 && Number(r.week) <= 30],
        ['away_team', TEAM.test(r.away_team)],
        ['home_team', TEAM.test(r.home_team) && r.away_team !== r.home_team],
        ['source_game_id', ID.test(r.source_game_id)],
        ['source_play_id', ID.test(r.source_play_id)],
        ['quarter', /^[1-9]$/.test(r.quarter)],
        ['clock', /^\d{1,2}:[0-5]\d$/.test(r.clock) && Number(r.clock.split(':')[0]) <= 15],
        ['side', ['offense', 'defense'].includes(r.side)],
        ['team', [r.away_team, r.home_team].includes(r.team)],
        ['source_player_id', ID.test(r.source_player_id)],
        ['gsis_id', !r.gsis_id || ID.test(r.gsis_id)],
        ['down', !r.down || /^[1-4]$/.test(r.down)],
        ['yards_to_go', !r.yards_to_go || /^\d{1,3}$/.test(r.yards_to_go)],
        ['jersey_number', !r.jersey_number || /^\d{1,2}$/.test(r.jersey_number)],
        ['position', !r.position || /^[A-Z]{1,8}$/.test(r.position)],
        ['captured_at', Number.isFinite(Date.parse(r.captured_at))],
      ];
      for (const [field, valid] of checks) {
        if (!valid) throw invalidField(field, r[field], r, index);
      }
      const key = JSON.stringify(COLUMNS.slice(1, 7).map((c) => r[c]));
      if (gameKey && gameKey !== key) throw new Error('Participation CSV contains more than one game.');
      gameKey = key;
      const metadata = JSON.stringify(COLUMNS.slice(0, 13).map((c) => r[c]));
      let play = plays.get(r.source_play_id);
      if (!play) plays.set(r.source_play_id, play = { metadata, rows: [], ids: new Set(), gsis: new Set(), teams: new Map() });
      if (play.metadata !== metadata) throw new Error('Conflicting situation data for one source play.');
      if (play.ids.has(r.source_player_id)) throw new Error('Duplicate player on one source play.');
      if (r.gsis_id && play.gsis.has(r.gsis_id)) throw new Error('Duplicate GSIS player on one source play.');
      play.ids.add(r.source_player_id);
      if (r.gsis_id) play.gsis.add(r.gsis_id);
      if (play.teams.has(r.side) && play.teams.get(r.side) !== r.team) throw new Error('Conflicting team for one side.');
      play.teams.set(r.side, r.team);
      play.rows.push(r);
    }
    for (const p of plays.values()) {
      if (p.teams.size === 2 && p.teams.get('offense') === p.teams.get('defense')) throw new Error('Both sides have the same team.');
      for (const side of ['offense', 'defense']) {
        if (p.rows.filter((r) => r.side === side).length > 11) throw new Error('More than 11 players on one side.');
      }
    }
    return [...plays.values()].map((p) => p.rows);
  }

  function clock(s) {
    const m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function completeSides(rows) {
    return ['offense', 'defense'].filter((side) => rows.filter((row) => row.side === side).length === 11).length;
  }

  function match(rows, plays) {
    const r = rows[0];
    const offense = rows.find((x) => x.side === 'offense')?.team;
    const defense = rows.find((x) => x.side === 'defense')?.team;
    const kickoffPattern = /\bkicks(?:\s+onside)?\s+\d+\s+yards\s+from\b/i;
    const kickoff = kickoffPattern.test(r.description);
    // NFL Pro labels the kicking team as offense; nflverse assigns possession to the receiving team.
    const candidates = plays.filter((p) =>
      p.qtr === Number(r.quarter) && clock(p.time) === clock(r.clock) &&
      (!kickoff || p.playType === 'kickoff' || (p.playType === 'no_play' && kickoffPattern.test(p.desc))) &&
      (((!offense || p.posteam === offense) && (!defense || p.defteam === defense)) ||
        (kickoff && (!offense || p.defteam === offense) && (!defense || p.posteam === defense))) &&
      (!r.down || p.down === Number(r.down)) && (!r.yards_to_go || p.ydstogo === Number(r.yards_to_go)));
    // Source IDs are not assumed to be nflverse IDs. Situation must agree even for an ID match.
    const exact = candidates.filter((p) => String(p.playId) === r.source_play_id);
    if (exact.length === 1) return exact[0];
    if (candidates.length === 1) return candidates[0];
    const normalize = (s) => s.toLowerCase().replace(/^\([^)]*\)\s*/, '')
      .replace(/\b\d{1,2}-(?=[a-z]+\.)/g, '').replace(/\bblt\b/g, 'bal').replace(/[^a-z0-9]/g, '');
    const description = normalize(r.description);
    const described = description ? candidates.filter((p) => normalize(p.desc) === description) : [];
    return described.length === 1 ? described[0] : null;
  }

  return { COLUMNS, csv, validate, match, completeSides, validationValue };
});
