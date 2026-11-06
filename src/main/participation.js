'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseCSV } = require('../shared/csv');
const schema = require('../shared/participation');
const advanced = require('../shared/advanced');

function attachImports(folder, game, plays) {
  const warnings = [];
  if (!folder || !game) return warnings;
  let files;
  try {
    files = fs.readdirSync(folder).filter((f) => /^nflpro-.*\.csv$/i.test(f)).sort();
  } catch (e) {
    return [`Participation folder unavailable (${e.message})`];
  }
  const imported = new Map();
  for (const file of files) {
    try {
      const location = path.join(folder, file);
      const stat = fs.lstatSync(location);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Expected a CSV file smaller than 8 MB.');
      const { rows, header } = parseCSV(fs.readFileSync(location, 'utf8'));
      const groups = schema.validate(rows, header);
      const r = rows[0];
      // Postseason week numbering differs by provider; a postseason matchup occurs only once.
      if (Number(r.season) !== game.season || r.season_type !== game.gameType ||
          (r.season_type !== 'POST' && Number(r.week) !== game.week) ||
          r.away_team !== game.awayTeam || r.home_team !== game.homeTeam) continue;
      let unmatched = 0;
      const staged = new Map(imported);
      for (const group of groups) {
        const p = schema.match(group, plays);
        if (!p) { unmatched++; continue; }
        const prior = staged.get(p.playId);
        const time = Math.max(...group.map((row) => Date.parse(row.captured_at)));
        const completeSides = schema.completeSides(group);
        if (prior && prior.source !== r.source_game_id) throw new Error('Conflicting source games match the same play.');
        if (prior && prior.rows[0].source_play_id !== group[0].source_play_id) {
          throw new Error(`Multiple source plays (${prior.rows[0].source_play_id}, ${group[0].source_play_id}) match nflverse play ${p.playId}.`);
        }
        if (!prior || completeSides > prior.completeSides ||
            (completeSides === prior.completeSides && (group.length > prior.rows.length ||
              (group.length === prior.rows.length && time > prior.time)))) {
          staged.set(p.playId, { rows: group, time, completeSides, source: r.source_game_id });
        }
      }
      for (const [key, record] of staged) imported.set(key, record);
      if (unmatched) warnings.push(`${file}: ${unmatched} source plays could not be matched unambiguously.`);
    } catch (e) {
      warnings.push(`${file}: ${e.message}`);
    }
  }
  for (const p of plays) {
    const record = imported.get(p.playId);
    if (!record) continue;
    const onField = {};
    const sources = {};
    for (const side of ['offense', 'defense']) {
      const rows = record.rows.filter((r) => r.team === (side === 'offense' ? p.posteam : p.defteam));
      // An incomplete import must not displace a complete historical side.
      if (rows.length === 11 || rows.length > (p.onField?.[side]?.length || 0) || !p.onField?.[side]?.length) {
        onField[side] = rows.map((r) => ({
          id: r.gsis_id, sourceId: r.source_player_id, name: r.name,
          position: r.position, number: r.jersey_number,
        }));
        sources[side] = rows.length ? 'NFL Pro' : '';
      } else {
        onField[side] = p.onField[side];
        sources[side] = 'nflverse';
      }
    }
    p.onField = onField;
    p.participation = {
      source: 'NFL Pro', sourceGameId: record.source, sourcePlayId: record.rows[0].source_play_id,
      capturedAt: new Date(record.time).toISOString(),
      offenseSource: sources.offense, defenseSource: sources.defense,
      status: record.completeSides === 2 ? 'complete' : 'partial',
    };
    advanced.inferPersonnel(p);
  }
  return warnings;
}

module.exports = { attachImports };
