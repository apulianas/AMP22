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

  const OFFENSE_GROUPS = { RB: 'RB', HB: 'RB', FB: 'RB', TE: 'TE', WR: 'WR', QB: 'QB', C: 'OL', G: 'OL', T: 'OL', OL: 'OL', OT: 'OL', OG: 'OL', LT: 'OL', LG: 'OL', RG: 'OL', RT: 'OL' };
  const DEFENSE_GROUPS = { DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB', DB: 'DB', CB: 'DB', WR: 'DB', S: 'DB', FS: 'DB', SS: 'DB', SAF: 'DB' };
  const SPECIALISTS = ['K', 'P', 'LS'];

  /** Display order for defensive packages (lightest coverage personnel last). */
  const DEFENSE_ORDER = ['Jumbo', 'Goal line', '5-3', '4-4', '6-2', '5-2', '4-3', '3-4', '2-5', '3-3-5', 'Jumbo nickel', 'Nickel', '32 dime', 'Dime', 'Quarter'];
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

  /** RB then TE count, counting extra OL as TEs and suffixing the total OL, e.g. "12 (6)". */
  function offenseCode(personnel) {
    const counts = parsePersonnel(personnel);
    if (hasSpecialists(counts)) return '';
    const g = group(counts, OFFENSE_GROUPS);
    const extraOL = Math.max(0, (g.OL || 0) - 5);
    if (g.RB == null && g.TE == null && g.WR == null && !extraOL) return '';
    return `${g.RB || 0}${(g.TE || 0) + extraOL}${extraOL ? ` (${g.OL})` : ''}`;
  }

  function isJumbo(counts) {
    const g = group(counts, DEFENSE_GROUPS);
    return (g.DL || 0) >= 4 && (counts.OLB || 0) >= 2 && (g.DB || 0) <= 4 &&
      (g.DL || 0) + (g.LB || 0) + (g.DB || 0) === 11 && !hasSpecialists(counts);
  }

  function is32Dime(counts) {
    const g = group(counts, DEFENSE_GROUPS);
    const inside = (counts.ILB || 0) + (counts.MLB || 0);
    return (g.DL || 0) + (counts.OLB || 0) === 3 && inside === 2 &&
      g.LB === (counts.OLB || 0) + inside && g.DB === 6 && !hasSpecialists(counts);
  }

  function isJumboNickel(counts) {
    const g = group(counts, DEFENSE_GROUPS);
    const inside = (counts.ILB || 0) + (counts.MLB || 0);
    return g.DL === 3 && counts.OLB === 1 && inside === 2 && g.LB === 3 &&
      g.DB === 5 && !hasSpecialists(counts);
  }

  function compositionPackage(counts) {
    if (isJumbo(counts)) return 'Jumbo';
    if (isJumboNickel(counts)) return 'Jumbo nickel';
    if (is32Dime(counts)) return '32 dime';
    return '';
  }

  function formatDefensePackage(label, front) {
    return [label, ['3-4', '4-3', 'Jumbo', 'Jumbo nickel', '32 dime'].includes(label) ? '' : front].filter(Boolean).join(' ');
  }

  /**
   * Defensive package from personnel. Returns { label, front } where front is "DL-LB-DB"
   * (e.g. "4-2-5"). Complete heavy fronts with 4+ DL, 2+ OLB and at most 4 DBs are Jumbo.
   * Three DL/OLB plus two explicit inside linebackers and six DBs are 32 dime.
   * Three DL, one OLB, two explicit inside linebackers and five DBs are Jumbo nickel.
   * Otherwise four DBs are labelled by their front ("4-3", "3-4"); five or more by
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
    let label = compositionPackage(counts);
    if (label) return { label, front: `${dl}-${lb}-${db}` };
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

  function playerKey(player) {
    return player.id || (player.sourceId ? `nflpro:${player.sourceId}` : '');
  }

  const GENERIC_LINE = { T: ['LT', 'RT'], OT: ['LT', 'RT'], G: ['LG', 'RG'], OG: ['LG', 'RG'], OL: ['LT', 'LG', 'C', 'RG', 'RT'] };
  const OFFENSE_ORDER = ['WR', 'RB', 'FB', 'TE', 'EL', 'QB', 'LT', 'LG', 'C', 'RG', 'RT', 'G', 'T', 'OL', 'K', 'P', 'LS'];
  const DEFENSE_POSITIONS = { LDE: 'DE', RDE: 'DE', NT: 'DT', LDT: 'DT', RDT: 'DT',
    LOLB: 'OLB', ROLB: 'OLB', MLB: 'ILB', FS: 'S', SS: 'S', SAF: 'S', DB: 'CB' };
  const DEFENSE_POSITION_ORDER = ['DE', 'DT', 'DL', 'OLB', 'ILB', 'LB', 'CB', 'S', 'K', 'P', 'LS'];
  const PLAYER_POSITION_ORDER = [...OFFENSE_ORDER.filter(position => !SPECIALISTS.includes(position)), ...DEFENSE_POSITION_ORDER];

  function needsDepthPosition(player) {
    return !!GENERIC_LINE[player.position];
  }

  function attachDepthPositions(play, charts) {
    for (const player of play.onField?.offense || []) {
      delete player.positionInference;
      if (!needsDepthPosition(player) || !player.id) continue;
      const chart = charts.get(play.posteam);
      const record = chart?.players.get(player.id);
      // A backup listed equally at both tackle/guard spots does not establish a side.
      if (!record || record.positions.size !== 1) continue;
      const position = [...record.positions][0];
      if (GENERIC_LINE[player.position].includes(position)) {
        player.positionInference = { position, source: chart.source, asOf: chart.asOf };
      }
    }
  }

  function annotateEligible(play) {
    const players = play.onField?.offense || [];
    for (const player of players) delete player.eligibleReceiver;
    const linemen = players.filter(player => needsDepthPosition(player) || ['LT', 'LG', 'C', 'RG', 'RT'].includes(player.position));
    if (linemen.length < 6) return;
    for (const match of (play.desc || '').matchAll(/\b(\d{1,2})-[a-z][a-z.'-]*\s+reported in as eligible\b/gi)) {
      const found = players.filter(player => int(player.number) === Number(match[1]));
      if (found.length === 1 && linemen.includes(found[0])) found[0].eligibleReceiver = true;
    }
  }

  function displayPosition(player) {
    return player.eligibleReceiver ? 'OL-E' : player.positionInference?.position || player.position || '?';
  }

  function playerPositionRank(player, side) {
    const order = side === 'offense' ? OFFENSE_ORDER : side === 'defense' ? DEFENSE_POSITION_ORDER : PLAYER_POSITION_ORDER;
    let position = displayPosition(player);
    if (player.eligibleReceiver) position = 'EL';
    else {
      if (side !== 'offense') position = DEFENSE_POSITIONS[position] || position;
      if (side !== 'defense') position = { HB: 'RB', OT: 'T', OG: 'G' }[position] || position;
    }
    const i = order.indexOf(position);
    return i < 0 ? order.length : i;
  }

  function orderedPlayers(play, side) {
    return (play.onField?.[side] || []).slice().sort((a, b) => playerPositionRank(a, side) - playerPositionRank(b, side) ||
      (int(a.number) ?? 100) - (int(b.number) ?? 100) || (a.name || '').localeCompare(b.name || '') ||
      playerKey(a).localeCompare(playerKey(b)));
  }

  function personnelDetail(players, groups) {
    if (players?.length !== 11 || new Set(players.map(playerKey)).size !== 11 ||
        players.some((p) => !playerKey(p) || !groups[p.position])) return '';
    const counts = {};
    for (const p of players) counts[p.position] = (counts[p.position] || 0) + 1;
    return Object.entries(counts).map(([pos, n]) => `${n} ${pos}`).join(', ');
  }

  function inferPersonnel(play) {
    if (!isScrimmage(play) || !play.onField) return;
    const offenseDetail = personnelDetail(play.onField.offense, OFFENSE_GROUPS);
    const offenseGroups = group(parsePersonnel(offenseDetail), OFFENSE_GROUPS);
    const knownOffense = offenseGroups.QB === 1 && offenseGroups.OL >= 5;
    const defenseDetail = personnelDetail(play.onField.defense, DEFENSE_GROUPS);
    const defense = defenseDetail ? defensePackage(defenseDetail) : null;
    play.inferredPersonnel = {
      offense: knownOffense ? offenseCode(offenseDetail) : '',
      offenseDetail, defense: defense?.label || '', front: defense?.front || '', defenseDetail,
    };
    if (play.inferredPersonnel.offense || defense) {
      const personnel = { ...play.personnel };
      if (play.inferredPersonnel.offense && (!personnel.offense || personnel.offenseInferred || offenseGroups.OL > 5)) {
        Object.assign(personnel, { offense: play.inferredPersonnel.offense, offenseDetail, offenseInferred: true });
      }
      if (defense && (!personnel.defense || compositionPackage(parsePersonnel(defenseDetail)))) {
        Object.assign(personnel, { defense: defense.label, front: defense.front, defenseDetail, defenseInferred: true });
      }
      if (personnel.offenseInferred || personnel.defenseInferred) personnel.inferred = true;
      play.personnel = personnel;
    }
  }

  /**
   * Adds `personnel`, `charting`, and `onField` to a normalized play from its participation
   * and FTN rows (either may be missing). Only scrimmage plays get advanced data.
   */
  function attach(play, part, ftn, directory) {
    if (!isScrimmage(play) || (!part && !ftn)) return play;
    const dropback = isDropback(play);
    const charting = {};
    const sources = {};
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
          ...(compositionPackage(parsePersonnel(part.defense_personnel)) ? { defenseInferred: true, inferred: true } : {}),
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
      if (group(parsePersonnel(personnelDetail(offense, OFFENSE_GROUPS)), OFFENSE_GROUPS).OL > 5 ||
          compositionPackage(parsePersonnel(personnelDetail(defense, DEFENSE_GROUPS)))) inferPersonnel(play);
    }
    for (const key of Object.keys(charting)) sources[key] = 'nflverse participation';
    if (ftn) {
      const ftnCharting = {};
      const qb = QB_LOCATIONS[str(ftn.qb_location).toUpperCase()];
      if (qb) ftnCharting.qbLocation = qb;
      const backfield = int(ftn.n_offense_backfield);
      if (backfield != null && qb) ftnCharting.backfield = backfield;
      const box = int(ftn.n_defense_box);
      if (box) ftnCharting.box = box;
      for (const [key, col] of [['motion', 'is_motion'], ['playAction', 'is_play_action'], ['rpo', 'is_rpo'], ['screen', 'is_screen_pass'], ['noHuddle', 'is_no_huddle']]) {
        const b = bool(ftn[col]);
        if (b != null) ftnCharting[key] = b;
      }
      if (dropback) {
        const rushers = int(ftn.n_pass_rushers);
        if (rushers) ftnCharting.rushers = rushers;
        const blitzers = int(ftn.n_blitzers);
        if (blitzers != null && rushers) ftnCharting.blitzers = blitzers;
      }
      Object.assign(charting, ftnCharting);
      for (const key of Object.keys(ftnCharting)) sources[key] = 'FTN';
    }
    if (Object.keys(charting).length) {
      play.charting = charting;
      play.chartingSources = sources;
    }
    return play;
  }

  function attachNFLProCharting(play, records) {
    if (!isScrimmage(play) || !Object.keys(records).length) return;
    const values = {};
    const conflicts = {};
    const charting = { ...play.charting };
    const sources = { ...play.chartingSources };
    for (const key of Object.keys(sources)) {
      if (sources[key] === 'NFL Pro / NGS') {
        delete charting[key];
        delete sources[key];
      }
    }
    for (const [key, record] of Object.entries(records)) {
      const value = record.value;
      values[key] = value;
      if (charting[key] == null || charting[key] === '') {
        charting[key] = value;
        sources[key] = 'NFL Pro / NGS';
      } else if (charting[key] !== value) {
        conflicts[key] = { source: sources[key] || 'nflverse', value: charting[key], nflPro: value };
      }
    }
    play.charting = charting;
    play.chartingSources = sources;
    play.nflProCharting = { values, provenance: records };
    if (Object.keys(conflicts).length) play.chartingConflicts = conflicts;
    else delete play.chartingConflicts;
  }

  /** Short tags describing a play's personnel/charting for display, e.g. ["12 personnel", "Nickel 4-2-5", "Shotgun"]. */
  function tags(play) {
    const out = [];
    const pers = play.personnel;
    const c = play.charting || {};
    if (pers && pers.offense) out.push(`${pers.offense} personnel`);
    if (pers && pers.defense) out.push(['Jumbo', 'Jumbo nickel', '32 dime'].includes(pers.defense) ? `${pers.defense}${pers.defenseInferred ? '*' : ''}` :
      /-4$/.test(pers.front) ? `${pers.defense} base` : `${pers.defense} ${pers.front}`);
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
    if (c.blitz != null) out.push(`NGS blitz: ${c.blitz ? 'Yes' : 'No'}`);
    if (c.pressure != null) out.push(`NGS pressure: ${c.pressure ? 'Yes' : 'No'}`);
    if (c.boxCategory) out.push(`NGS box: ${c.boxCategory}`);
    if (c.defPersonnelGroup) out.push(`NGS personnel: ${c.defPersonnelGroup}`);
    if (c.coverage || c.manZone) out.push([c.coverage, c.manZone].filter(Boolean).join(' '));
    return out;
  }

  return {
    PARTICIPATION_FIRST_SEASON, CHARTING_FIRST_SEASON, PARTICIPATION_COLUMNS, CHARTING_COLUMNS, DEFENSE_ORDER,
    parsePersonnel, offenseCode, defensePackage, compositionPackage, formatDefensePackage, coverageLabel, formationLabel, onFieldPlayers, attach, tags, playerKey, inferPersonnel, isScrimmage,
    needsDepthPosition, attachDepthPositions, annotateEligible, displayPosition, playerPositionRank, orderedPlayers, attachNFLProCharting,
  };
});
