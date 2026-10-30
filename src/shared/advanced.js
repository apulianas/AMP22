(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).advanced = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Advanced play data from two nflverse sources:
   *  - pbp_participation (2016+, published after each season): personnel, players on the field,
   *    formation, coverage. Before 2023 players are IDs only (GSIS or NGS `nfl_id`, varying by
   *    season); 2023+ also lists names, positions, and jersey numbers.
   *  - ftn_charting (2022+, updated during the season): backfield, box, motion, play action, RPO, etc.
   */
  const PARTICIPATION_FIRST_SEASON = 2016;
  const CHARTING_FIRST_SEASON = 2022;

  const PARTICIPATION_COLUMNS = [
    'nflverse_game_id', 'play_id', 'offense_formation', 'offense_personnel', 'defense_personnel',
    'defenders_in_box', 'number_of_pass_rushers', 'offense_players', 'defense_players',
    'defense_man_zone_type', 'defense_coverage_type',
    'offense_names', 'defense_names', 'offense_positions', 'defense_positions', 'offense_numbers', 'defense_numbers',
  ];
  const CHARTING_COLUMNS = [
    'nflverse_game_id', 'nflverse_play_id', 'qb_location', 'n_offense_backfield', 'n_defense_box', 'is_no_huddle',
    'is_motion', 'is_play_action', 'is_screen_pass', 'is_rpo', 'n_blitzers', 'n_pass_rushers',
  ];

  const OFFENSE_GROUPS = { RB: 'RB', HB: 'RB', FB: 'RB', TE: 'TE', WR: 'WR', QB: 'QB', C: 'OL', G: 'OL', T: 'OL', OL: 'OL', OT: 'OL', OG: 'OL' };
  const DEFENSE_GROUPS = { DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB', DB: 'DB', CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', SAF: 'DB' };
  const SPECIALISTS = ['K', 'P', 'LS'];

  /** Display order for defensive packages (lightest coverage personnel last). */
  const DEFENSE_ORDER = ['Goal line', '5-3', '4-4', '6-2', '5-2', '4-3', '3-4', '2-5', '3-3-5', 'Nickel', 'Dime', 'Quarter'];
  const COVERAGE_LABELS = {
    COVER_0: 'Cover 0', COVER_1: 'Cover 1', COVER_2: 'Cover 2', '2_MAN': '2-Man', COVER_3: 'Cover 3', COVER_4: 'Cover 4',
    COVER_6: 'Cover 6', COVER_9: 'Cover 9', COMBO: 'Combo', PREVENT: 'Prevent', BLOWN: 'Blown',
  };
  const MAN_ZONE_LABELS = { MAN_COVERAGE: 'Man', ZONE_COVERAGE: 'Zone' };
  const QB_LOCATIONS = { S: 'Shotgun', U: 'Under center', P: 'Pistol', SHOTGUN: 'Shotgun', 'UNDER CENTER': 'Under center', PISTOL: 'Pistol' };

  function str(v) {
    return v == null || v === 'NA' ? '' : String(v).trim();
  }
  function int(v) {
    const s = str(v);
    if (s === '') return null;
    const n = Number(s);
    return Number.isInteger(n) ? n : null;
  }
  function bool(v) {
    const s = str(v).toUpperCase();
    if (s === 'TRUE' || s === '1') return true;
    if (s === 'FALSE' || s === '0') return false;
    return null;
  }
  function list(v) {
    return str(v).split(';').map((x) => x.trim()).filter(Boolean);
  }
  function titleCase(s) {
    return s.toLowerCase().replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bI Form\b/, 'I-Form');
  }

  /** "1 RB, 2 TE, 2 WR" -> { RB: 1, TE: 2, WR: 2 } (raw position codes). */
  function parsePersonnel(s) {
    const counts = {};
    for (const part of str(s).split(',')) {
      const m = /^\s*(\d+)\s+([A-Z]+)\s*$/i.exec(part);
      if (m) counts[m[2].toUpperCase()] = (counts[m[2].toUpperCase()] || 0) + Number(m[1]);
    }
    return counts;
  }

  function group(counts, groups) {
    const out = {};
    for (const [pos, n] of Object.entries(counts)) {
      const g = groups[pos];
      if (g) out[g] = (out[g] || 0) + n;
    }
    return out;
  }

  function hasSpecialists(counts) {
    return SPECIALISTS.some((p) => counts[p]);
  }

  /** Offensive personnel code: RB count then TE count, e.g. "11", "12", "21". '' when unknown. */
  function offenseCode(personnel) {
    const counts = parsePersonnel(personnel);
    if (hasSpecialists(counts)) return '';
    const g = group(counts, OFFENSE_GROUPS);
    if (g.RB == null && g.TE == null && g.WR == null) return '';
    return `${g.RB || 0}${g.TE || 0}`;
  }

  /**
   * Defensive package from personnel. Returns { label, front } where front is "DL-LB-DB"
   * (e.g. "4-2-5"). Four DBs are labelled by their front ("4-3", "3-4"); five or more by
   * sub-package (Nickel, Dime, Quarter); three or fewer are "Goal line".
   */
  function defensePackage(personnel) {
    const counts = parsePersonnel(personnel);
    if (hasSpecialists(counts)) return null;
    const g = group(counts, DEFENSE_GROUPS);
    const dl = g.DL || 0;
    const lb = g.LB || 0;
    const db = g.DB || 0;
    if (dl + lb + db < 9) return null;
    let label;
    if (db >= 7) label = 'Quarter';
    else if (db === 6) label = 'Dime';
    else if (db === 5) label = 'Nickel';
    else if (db === 4) label = `${dl}-${lb}`;
    else label = 'Goal line';
    return { label, front: `${dl}-${lb}-${db}` };
  }

  function coverageLabel(v) {
    const s = str(v).toUpperCase();
    return s ? COVERAGE_LABELS[s] || titleCase(s) : '';
  }

  /** Offense formation; 2023+ files only record the QB alignment here. */
  function formationLabel(v) {
    const s = str(v).toUpperCase();
    return s ? QB_LOCATIONS[s] || titleCase(s) : '';
  }

  /**
   * Players on the field. `directory` maps GSIS or NGS IDs -> {id (GSIS), name, position} and is
   * used for seasons whose participation lists only IDs.
   */
  function onFieldPlayers(row, side, directory) {
    const ids = list(row[`${side}_players`]);
    const names = list(row[`${side}_names`]);
    const positions = list(row[`${side}_positions`]);
    const numbers = list(row[`${side}_numbers`]);
    const named = names.length === ids.length;
    return ids.map((rawId, i) => {
      if (named) return { id: rawId, name: names[i], position: positions[i] || '', number: numbers[i] || '' };
      const known = directory && directory.get(rawId);
      return { id: known ? known.id : '', name: known ? known.name : '', position: known ? known.position : '', number: '' };
    });
  }

  function isScrimmage(play) {
    const pt = play.playType;
    if (pt === 'pass' || pt === 'run') return true;
    return pt === 'no_play' && !!(play.flags && (play.flags.pass || play.flags.rush));
  }
  function isDropback(play) {
    return !!(play.flags && (play.flags.pass || play.flags.qb_scramble || play.flags.sack));
  }

  /**
   * Adds `personnel`, `charting`, and `onField` to a normalized play from its participation
   * and FTN rows (either may be missing). Only scrimmage plays get advanced data.
   */
  function attach(play, part, ftn, directory) {
    if (!isScrimmage(play) || (!part && !ftn)) return play;
    const dropback = isDropback(play);
    const charting = {};
    if (part) {
      const off = offenseCode(part.offense_personnel);
      const def = defensePackage(part.defense_personnel);
      if (off || def) {
        play.personnel = {
          offense: off,
          offenseDetail: str(part.offense_personnel),
          defense: def ? def.label : '',
          front: def ? def.front : '',
          defenseDetail: str(part.defense_personnel),
        };
      }
      const formation = formationLabel(part.offense_formation);
      if (['Shotgun', 'Under center', 'Pistol'].includes(formation)) charting.qbLocation = formation;
      else if (formation) charting.formation = formation;
      const box = int(part.defenders_in_box);
      if (box) charting.box = box;
      const rushers = int(part.number_of_pass_rushers);
      if (dropback && rushers) charting.rushers = rushers;
      if (coverageLabel(part.defense_coverage_type)) charting.coverage = coverageLabel(part.defense_coverage_type);
      if (MAN_ZONE_LABELS[str(part.defense_man_zone_type)]) charting.manZone = MAN_ZONE_LABELS[str(part.defense_man_zone_type)];
      const offense = onFieldPlayers(part, 'offense', directory);
      const defense = onFieldPlayers(part, 'defense', directory);
      if (offense.length || defense.length) play.onField = { offense, defense };
    }
    if (ftn) {
      const qb = QB_LOCATIONS[str(ftn.qb_location).toUpperCase()];
      if (qb) charting.qbLocation = qb;
      const backfield = int(ftn.n_offense_backfield);
      if (backfield != null && qb) charting.backfield = backfield;
      const box = int(ftn.n_defense_box);
      if (box) charting.box = box;
      for (const [key, col] of [['motion', 'is_motion'], ['playAction', 'is_play_action'], ['rpo', 'is_rpo'], ['screen', 'is_screen_pass'], ['noHuddle', 'is_no_huddle']]) {
        const b = bool(ftn[col]);
        if (b != null) charting[key] = b;
      }
      if (dropback) {
        const rushers = int(ftn.n_pass_rushers);
        if (rushers) charting.rushers = rushers;
        const blitzers = int(ftn.n_blitzers);
        if (blitzers != null && rushers) charting.blitzers = blitzers;
      }
    }
    if (Object.keys(charting).length) play.charting = charting;
    return play;
  }

  /** Short tags describing a play's personnel/charting for display, e.g. ["12 personnel", "Nickel 4-2-5", "Shotgun"]. */
  function tags(play) {
    const out = [];
    const pers = play.personnel;
    const c = play.charting || {};
    if (pers && pers.offense) out.push(`${pers.offense} personnel`);
    if (pers && pers.defense) out.push(/-4$/.test(pers.front) ? `${pers.defense} base` : `${pers.defense} ${pers.front}`);
    if (c.qbLocation) out.push(c.qbLocation);
    if (c.formation) out.push(c.formation);
    if (c.backfield != null) out.push(`${c.backfield} in backfield`);
    if (c.noHuddle) out.push('No-huddle');
    if (c.motion) out.push('Motion');
    if (c.playAction) out.push('Play action');
    if (c.rpo) out.push('RPO');
    if (c.screen) out.push('Screen');
    if (c.box) out.push(`${c.box} in box`);
    if (c.rushers) out.push(`${c.rushers} rushers`);
    if (c.blitzers) out.push(`${c.blitzers} blitzer${c.blitzers === 1 ? '' : 's'}`);
    if (c.coverage || c.manZone) out.push([c.coverage, c.manZone].filter(Boolean).join(' '));
    return out;
  }

  return {
    PARTICIPATION_FIRST_SEASON, CHARTING_FIRST_SEASON, PARTICIPATION_COLUMNS, CHARTING_COLUMNS, DEFENSE_ORDER,
    parsePersonnel, offenseCode, defensePackage, coverageLabel, formationLabel, onFieldPlayers, attach, tags,
  };
});
