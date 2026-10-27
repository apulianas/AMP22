(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).plays = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** nflverse play-by-play columns the app keeps. */
  const PBP_COLUMNS = [
    'play_id', 'game_id', 'season', 'week', 'season_type', 'home_team', 'away_team', 'posteam', 'defteam',
    'qtr', 'time', 'down', 'ydstogo', 'yrdln', 'desc', 'play_type', 'yards_gained', 'air_yards', 'drive',
    'touchdown', 'pass_touchdown', 'rush_touchdown', 'return_touchdown', 'td_team', 'interception', 'fumble_lost',
    'sack', 'penalty', 'safety', 'pass', 'rush', 'qb_scramble', 'timeout', 'two_point_attempt',
    'fourth_down_converted', 'fourth_down_failed', 'field_goal_result', 'extra_point_result', 'two_point_conv_result',
    'total_home_score', 'total_away_score', 'epa',
    'passer_player_name', 'receiver_player_name', 'rusher_player_name', 'sack_player_name', 'half_sack_1_player_name',
    'interception_player_name', 'kicker_player_name', 'punter_player_name', 'kickoff_returner_player_name',
    'punt_returner_player_name', 'fumbled_1_player_name', 'fumble_recovery_1_player_name', 'fumble_recovery_1_team',
    'td_player_name', 'complete_pass', 'incomplete_pass', 'touchback', 'punt_blocked', 'first_down', 'qb_kneel',
    'kick_distance', 'return_yards', 'penalty_team', 'penalty_player_name', 'penalty_yards', 'penalty_type',
    'fixed_drive', 'fixed_drive_result', 'drive_play_count', 'drive_time_of_possession', 'ydsnet',
    'rusher_player_id', 'receiver_player_id', 'sack_player_id', 'half_sack_1_player_id',
    'interception_player_id', 'fumble_recovery_1_player_id', 'fumble_recovery_2_player_id',
    'fumble_recovery_2_player_name', 'fumble_recovery_2_team',
  ];

  const FLAG_COLUMNS = [
    'touchdown', 'pass_touchdown', 'rush_touchdown', 'return_touchdown', 'interception', 'fumble_lost', 'sack',
    'penalty', 'safety', 'pass', 'rush', 'qb_scramble', 'timeout', 'two_point_attempt', 'fourth_down_converted',
    'fourth_down_failed', 'complete_pass', 'incomplete_pass', 'touchback', 'punt_blocked', 'first_down', 'qb_kneel',
  ];

  const DEFAULT_KEY_PLAYS = {
    turnovers: true, // INT, lost fumble, turnover on downs
    scores: true, // TD, FG made, safety, 2-pt good
    runYards: 10, // runs of at least this many yards (0 = off)
    passYards: 20, // completions of at least this many yards (0 = off)
    sacks: false,
    fourthDownConversions: true,
    lossYards: 3, // negative plays: losses of at least this many yards (0 = off); sacks always count
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
      airYards: num(row.air_yards),
      drive: num(row.drive),
      tdTeam: str(row.td_team),
      fieldGoalResult: str(row.field_goal_result),
      extraPointResult: str(row.extra_point_result),
      twoPointResult: str(row.two_point_conv_result),
      homeScore: num(row.total_home_score),
      awayScore: num(row.total_away_score),
      epa: num(row.epa),
      names: {
        passer: str(row.passer_player_name),
        receiver: str(row.receiver_player_name),
        rusher: str(row.rusher_player_name),
        sacker: str(row.sack_player_name) || str(row.half_sack_1_player_name),
        interceptor: str(row.interception_player_name),
        kicker: str(row.kicker_player_name),
        punter: str(row.punter_player_name),
        returner: str(row.kickoff_returner_player_name) || str(row.punt_returner_player_name),
        fumbler: str(row.fumbled_1_player_name),
        recoverer: str(row.fumble_recovery_1_player_name),
        recoverer2: str(row.fumble_recovery_2_player_name),
        penalty: str(row.penalty_player_name),
      },
      playerIds: {
        rusher: str(row.rusher_player_id),
        receiver: str(row.receiver_player_id),
        sacker: str(row.sack_player_id) || str(row.half_sack_1_player_id),
        interceptor: str(row.interception_player_id),
        recoverer: str(row.fumble_recovery_1_player_id),
        recoverer2: str(row.fumble_recovery_2_player_id),
      },
      fumbleRecoveryTeam: str(row.fumble_recovery_1_team),
      fumbleRecovery2Team: str(row.fumble_recovery_2_team),
      kickDistance: num(row.kick_distance),
      returnYards: num(row.return_yards),
      penaltyTeam: str(row.penalty_team),
      penaltyType: str(row.penalty_type),
      penaltyYards: num(row.penalty_yards),
      driveNum: num(row.fixed_drive) != null ? num(row.fixed_drive) : num(row.drive),
      driveResult: str(row.fixed_drive_result),
      drivePlays: num(row.drive_play_count),
      driveTop: str(row.drive_time_of_possession),
      driveYards: num(row.ydsnet),
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

  /**
   * Reasons a play is a negative play for the offense (empty array if not): SACK, or LOSS for
   * runs/completions that lose at least cfg.lossYards.
   */
  function negativeReasons(p, cfg) {
    const c = Object.assign({}, DEFAULT_KEY_PLAYS, cfg || {});
    if (p.playType === 'no_play' || p.flags.qb_kneel || p.playType === 'qb_kneel') return [];
    if (p.flags.sack) return ['SACK'];
    const cat = category(p);
    if ((cat === 'run' || cat === 'pass') && c.lossYards > 0 && p.yards != null && p.yards <= -c.lossYards) return ['LOSS'];
    return [];
  }

  function signed(y) {
    if (y == null) return '';
    return y > 0 ? `+${y}` : y < 0 ? `\u2212${-y}` : '0';
  }

  /**
   * Compact box-score summary of a play: { who, yards, result, tone }.
   *  who    – player(s) and action, e.g. "T.Huntley → Z.Flowers"
   *  yards  – signed yards ("+48", "−7") or '' when not meaningful
   *  result – short outcome tag, e.g. "TD", "INC", "INT", "1st down", "Touchback"
   *  tone   – 'good' | 'bad' | '' for colouring the yards
   */
  function boxScore(p) {
    const n = p.names || {};
    const f = p.flags;
    const pt = p.playType;
    const tone = (y) => (y == null ? '' : y > 0 ? 'good' : y < 0 ? 'bad' : '');
    const out = (who, yards, result, t) => ({ who, yards: yards == null ? '' : signed(yards), result: result || '', tone: t == null ? tone(yards) : t });
    const tdOr = (fallback) => (f.touchdown ? 'TD' : fallback);
    const pen = () => {
      const team = p.penaltyTeam ? `${p.penaltyTeam} ` : '';
      const type = p.penaltyType || 'Penalty';
      return `${team}${type}${p.penaltyYards ? `, ${p.penaltyYards} yds` : ''}`;
    };
    if (pt === 'no_play') {
      if (f.penalty) return out(pen() + (n.penalty ? ` (${n.penalty})` : ''), null, 'No play', '');
      return out('No play', null, '', '');
    }
    const fum = f.fumble_lost ? `FUM${n.recoverer ? ' rec. ' + n.recoverer : ''}` : '';
    let r;
    if (pt === 'kickoff' || pt === 'punt') {
      const kicker = (pt === 'kickoff' ? n.kicker : n.punter) || p.posteam;
      const what = pt === 'kickoff' ? 'kickoff' : 'punt';
      const dist = p.kickDistance != null ? ` ${p.kickDistance} yds` : '';
      if (f.punt_blocked) r = out(`${kicker} ${what}`, null, 'Blocked', 'bad');
      else if (/fair catch/i.test(p.desc)) r = out(`${kicker} ${what}${dist}${n.returner ? ' · ' + n.returner : ''}`, null, 'Fair catch', '');
      else if (f.touchback) r = out(`${kicker} ${what}${dist}`, null, 'Touchback', '');
      else if (n.returner) r = out(`${kicker} ${what}${dist} · ${n.returner} ret`, p.returnYards, tdOr(fum), '');
      else r = out(`${kicker} ${what}${dist}`, null, /out of bounds/i.test(p.desc) ? 'Out of bounds' : /downed/i.test(p.desc) ? 'Downed' : '', '');
    } else if (pt === 'field_goal') {
      const res = { made: 'Good', missed: 'No good', blocked: 'Blocked' }[p.fieldGoalResult] || p.fieldGoalResult;
      r = out(`${n.kicker || p.posteam} ${p.kickDistance != null ? p.kickDistance + '-yd ' : ''}FG`, null, res, p.fieldGoalResult === 'made' ? 'good' : 'bad');
    } else if (pt === 'extra_point') {
      const res = { good: 'Good', failed: 'No good', blocked: 'Blocked', aborted: 'Aborted' }[p.extraPointResult] || p.extraPointResult;
      r = out(`${n.kicker || p.posteam} XP`, null, res, p.extraPointResult === 'good' ? 'good' : 'bad');
    } else if (f.two_point_attempt) {
      const who = n.passer ? `${n.passer}${n.receiver ? ' → ' + n.receiver : ''}` : n.rusher || p.posteam;
      r = out(`${who} 2-pt`, null, p.twoPointResult === 'success' ? 'Good' : 'No good', p.twoPointResult === 'success' ? 'good' : 'bad');
    } else if (f.sack) {
      r = out(`${n.passer || p.posteam} sacked${n.sacker ? ' by ' + n.sacker : ''}`, p.yards, fum, 'bad');
    } else if (pt === 'qb_spike') {
      r = out(`${n.passer || p.posteam} spike`, null, '', '');
    } else if (pt === 'qb_kneel' || f.qb_kneel) {
      r = out(`${n.rusher || n.passer || p.posteam} kneel`, p.yards, '', '');
    } else if (pt === 'pass' || f.pass) {
      const who = `${n.passer || p.posteam}${n.receiver ? ' → ' + n.receiver : ''}`;
      if (f.interception) r = out(who, null, `INT${n.interceptor ? ' ' + n.interceptor : ''}`, 'bad');
      else if (f.complete_pass) r = out(who, p.yards, tdOr(fum || (f.first_down ? '1st down' : '')));
      else if (n.rusher) r = out(`${n.rusher} scramble`, p.yards, tdOr(fum || (f.first_down ? '1st down' : '')));
      else r = out(who, null, 'INC', '');
    } else if (pt === 'run' || f.rush) {
      r = out(`${n.rusher || p.posteam}${f.qb_scramble ? ' scramble' : ''}`, p.yards, tdOr(fum || (f.first_down ? '1st down' : '')));
    } else {
      r = out(p.playType || 'Play', p.yards, '');
    }
    if (f.penalty && !r.result.includes('No play')) r.penalty = pen();
    return r;
  }

  function overlaySummary(p) {
    const box = boxScore(p);
    const f = p.flags;
    let yards = box.yards;
    if (p.playType !== 'no_play' && !SPECIAL.includes(p.playType) && !f.two_point_attempt &&
        !f.sack && !f.interception && p.playType !== 'qb_kneel' && !f.qb_kneel && p.playType !== 'qb_spike') {
      const action = f.complete_pass ? 'reception' : p.playType === 'run' || f.rush || p.names?.rusher ? 'rush' : '';
      if (action) yards = `${p.yards == null ? '' : `${p.yards} yard `}${action}`;
    }
    return [box.who, yards, box.result].filter(Boolean).join('  ');
  }

  /** Short drive result label, e.g. "Touchdown", "Punt". */
  function driveLabel(p) {
    return p.driveResult || '';
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

  function primaryPlayer(p) {
    const names = p.names || {};
    const ids = p.playerIds || {};
    const flags = p.flags || {};
    if (p.playType === 'no_play') return null;
    let role;
    if (flags.interception) role = 'interceptor';
    else if (flags.fumble_lost) {
      if (p.fumbleRecoveryTeam && p.fumbleRecoveryTeam !== p.posteam) role = 'recoverer';
      else if (p.fumbleRecovery2Team && p.fumbleRecovery2Team !== p.posteam) role = 'recoverer2';
      else if (!p.fumbleRecoveryTeam) role = 'recoverer';
    }
    // Do not attribute a turnover to an offensive player when its defender is unknown.
    if (flags.interception || flags.fumble_lost) {
      return role && (ids[role] || names[role]) ? { id: ids[role] || '', name: names[role] || '', role } : null;
    }
    if (flags.sack) role = 'sacker';
    else if (names.rusher || ids.rusher) role = 'rusher';
    else if (flags.complete_pass) role = 'receiver';
    return role && (ids[role] || names[role]) ? { id: ids[role] || '', name: names[role] || '', role } : null;
  }

  /** Normalized, filtered list of real plays for a game, in order. */
  function gamePlays(rows) {
    return rows.map((r) => (r.flags ? r : normalizePlay(r))).filter(isRealPlay);
  }

  return {
    PBP_COLUMNS, DEFAULT_KEY_PLAYS, normalizePlay, isRealPlay, category, filmWeight, keyReasons, negativeReasons,
    boxScore, overlaySummary, driveLabel, downDistance, clockLabel, primaryPlayer, gamePlays,
  };
});
