'use strict';

const { parseCSV } = require('../shared/csv');

const LINE_POSITIONS = ['LT', 'LG', 'C', 'RG', 'RT'];
const COLUMNS = ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank',
  'season', 'club_code', 'week', 'game_type', 'depth_position', 'depth_team'];

function indexDepthCharts(text) {
  const teams = new Map();
  const { header } = parseCSV(text, { columns: COLUMNS, onRow(row) {
    const position = row.pos_abb || row.depth_position;
    const team = row.team || row.club_code;
    const rank = Number(row.pos_rank || row.depth_team);
    if (!LINE_POSITIONS.includes(position) || !team || !/^00-\d+$/.test(row.gsis_id) || !Number.isInteger(rank) || rank < 1) return;
    const timed = !!row.pos_abb;
    const at = timed ? Date.parse(row.dt) : null;
    if (timed && !Number.isFinite(at)) return;
    const key = timed ? row.dt : `${row.season}:${row.game_type}:${row.week}`;
    if (!teams.has(team)) teams.set(team, new Map());
    const snapshots = teams.get(team);
    if (!snapshots.has(key)) snapshots.set(key, {
      at, date: row.dt.slice(0, 10), key,
      asOf: row.dt || `${row.season} ${row.game_type} week ${row.week}`, players: new Map(),
      source: timed ? 'nflverse/ESPN depth chart' : 'nflverse depth chart',
    });
    const players = snapshots.get(key).players;
    const prior = players.get(row.gsis_id);
    if (!prior || rank < prior.rank) players.set(row.gsis_id, { rank, positions: new Set([position]) });
    else if (rank === prior.rank) prior.positions.add(position);
  } });
  const modern = ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank'].every(c => header.includes(c));
  const legacy = ['season', 'club_code', 'week', 'game_type', 'gsis_id', 'depth_position', 'depth_team'].every(c => header.includes(c));
  if (!modern && !legacy) throw new Error('Unsupported depth-chart columns.');
  return { modern, teams };
}

function chartForGame(index, game, team) {
  const snapshots = [...(index.teams.get(team)?.values() || [])];
  if (index.modern) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(game.gameday || '')) return null;
    return snapshots.filter(chart => chart.date <= game.gameday).sort((a, b) => b.at - a.at)[0] || null;
  }
  const type = ['WC', 'DIV', 'CON', 'SB'].includes(game.gameType) ? 'POST' : game.gameType;
  return snapshots.find(chart => chart.key === `${game.season}:${type}:${game.week}`) || null;
}

module.exports = { indexDepthCharts, chartForGame };
