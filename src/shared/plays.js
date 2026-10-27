(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).plays = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** nflverse play-by-play columns the app keeps. */
  const PBP_COLUMNS = [
    'play_id', 'game_id', 'season', 'week', 'season_type', 'home_team', 'away_team', 'posteam', 'defteam',
    'qtr', 'time', 'down', 'ydstogo', 'yrdln', 'desc', 'play_type', 'yards_gained', 'drive',
    'touchdown', 'pass_touchdown', 'rush_touchdown', 'return_touchdown', 'td_team', 'interception', 'fumble_lost',
    'sack', 'penalty', 'safety', 'pass', 'rush', 'qb_scramble', 'timeout', 'two_point_attempt',
    'fourth_down_converted', 'fourth_down_failed', 'field_goal_result', 'extra_point_result', 'two_point_conv_result',
    'total_home_score', 'total_away_score', 'epa',
  ];

  const FLAG_COLUMNS = [
    'touchdown', 'pass_touchdown', 'rush_touchdown', 'return_touchdown', 'interception', 'fumble_lost', 'sack',
    'penalty', 'safety', 'pass', 'rush', 'qb_scramble', 'timeout', 'two_point_attempt', 'fourth_down_converted',
    'fourth_down_failed',
  ];

  const DEFAULT_KEY_PLAYS = {
    turnovers: true, // INT, lost fumble, turnover on downs
    scores: true, // TD, FG made, safety, 2-pt good
    runYards: 10, // runs of at least this many yards (0 = off)
    passYards: 20, // completions of at least this many yards (0 = off)
    sacks: false,
    fourthDownConversions: true,
  };

  function num(v) {
    if (v === '' || v == null || v === 'NA') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  function str(v) {
    return v == null || v === 'NA' ? '' : String(v);
  }

  function normalizePlay(row) {
    const flags = {};
    for (const f of FLAG_COLUMNS) flags[f] = num(row[f]) === 1;
    return {
      playId: num(row.play_id),
      gameId: str(row.game_id),
      qtr: num(row.qtr),
      time: str(row.time),
      down: num(row.down),
      ydstogo: num(row.ydstogo),
      yrdln: str(row.yrdln),
      posteam: str(row.posteam),
      defteam: str(row.defteam),
      desc: str(row.desc),
      playType: str(row.play_type),
      yards: num(row.yards_gained),
      drive: num(row.drive),
      tdTeam: str(row.td_team),
      fieldGoalResult: str(row.field_goal_result),
      extraPointResult: str(row.extra_point_result),
      twoPointResult: str(row.two_point_conv_result),
      homeScore: num(row.total_home_score),
      awayScore: num(row.total_away_score),
      epa: num(row.epa),
      flags,
    };
  }

  /** True for rows that are actual snaps/kicks (not GAME/END QUARTER/timeouts/2-minute warning). */
  function isRealPlay(p) {
    if (!p.playType) return false;
    if (/^\s*(timeout|two-minute warning|end (quarter|game|of))/i.test(p.desc)) return false;
    if (p.flags.timeout && p.playType === 'no_play' && !p.flags.pass && !p.flags.rush) return false;
    return true;
  }

  const SPECIAL = ['kickoff', 'punt', 'field_goal', 'extra_point'];

  /** 'run' | 'pass' | 'special' | 'penalty' (pre-snap / no play) | 'other' */
  function category(p) {
    const pt = p.playType;
    if (SPECIAL.includes(pt)) return 'special';
    if (pt === 'pass' || pt === 'qb_spike') return 'pass';
    if (pt === 'run' || pt === 'qb_kneel') return 'run';
    if (pt === 'no_play') {
      if (p.flags.pass) return 'pass';
      if (p.flags.rush) return 'run';
      if (/\b(punts|kicks|field goal|extra point)\b/i.test(p.desc)) return 'special';
      return 'penalty';
    }
    return 'other';
  }

  /**
   * Likelihood (0–1) that the play appears on the film. A22 usually includes pre-snap
   * penalties too, but not always, so they get a soft weight.
   */
  function filmWeight(p) {
    const c = category(p);
    if (c === 'penalty') return 0.5;
    return c === 'other' ? 0 : 1;
  }

  /** Reasons a play is "key" (empty array if not). */
  function keyReasons(p, cfg) {
    const c = Object.assign({}, DEFAULT_KEY_PLAYS, cfg || {});
    const f = p.flags;
    const cat = category(p);
    const live = p.playType !== 'no_play';
    const r = [];
    if (c.turnovers && live) {
      if (f.interception) r.push('INT');
      if (f.fumble_lost) r.push('FUM');
      if (f.fourth_down_failed && (cat === 'run' || cat === 'pass')) r.push('TOD');
    }
    if (c.scores && live) {
      if (f.touchdown) r.push('TD');
      if (p.fieldGoalResult === 'made') r.push('FG');
      if (f.safety) r.push('SAF');
      if (p.twoPointResult === 'success') r.push('2PT');
    }
    if (live && p.yards != null) {
      if ((cat === 'run' && c.runYards > 0 && p.yards >= c.runYards) || (cat === 'pass' && c.passYards > 0 && p.yards >= c.passYards)) r.push('BIG');
    }
    if (c.sacks && live && f.sack) r.push('SACK');
    if (c.fourthDownConversions && live && f.fourth_down_converted) r.push('4TH');
    return r;
  }

  function ordinal(n) {
    return ['', '1st', '2nd', '3rd', '4th'][n] || `${n}th`;
  }

  function downDistance(p) {
    if (!p.down) return '';
    const [side, yd] = p.yrdln.split(' ');
    const goal = p.ydstogo != null && side && side !== p.posteam && Number(yd) === p.ydstogo;
    const togo = goal ? 'Goal' : p.ydstogo;
    return `${ordinal(p.down)} & ${togo}`;
  }

  function clockLabel(p) {
    if (!p.qtr) return '';
    return `${p.qtr === 5 ? 'OT' : 'Q' + p.qtr} ${p.time}`;
  }

  /** Normalized, filtered list of real plays for a game, in order. */
  function gamePlays(rows) {
    return rows.map((r) => (r.flags ? r : normalizePlay(r))).filter(isRealPlay);
  }

  return { PBP_COLUMNS, DEFAULT_KEY_PLAYS, normalizePlay, isRealPlay, category, filmWeight, keyReasons, downDistance, clockLabel, gamePlays };
});
