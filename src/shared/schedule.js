'use strict';

function num(v) {
  if (v === '' || v == null || v === 'NA') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function parseGames(rows) {
  return rows
    .map((r) => ({
      gameId: r.game_id,
      season: num(r.season),
      gameType: r.game_type,
      week: num(r.week),
      gameday: r.gameday || '',
      awayTeam: r.away_team,
      homeTeam: r.home_team,
      awayScore: num(r.away_score),
      homeScore: num(r.home_score),
    }))
    .filter((g) => g.gameId && g.season && g.week);
}

function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function seasons(games) {
  return [...new Set(games.map((g) => g.season))].sort((a, b) => b - a);
}

function teamsInSeason(games, season) {
  const s = new Set();
  for (const g of games) if (g.season === season) { s.add(g.homeTeam); s.add(g.awayTeam); }
  return [...s].sort();
}

function teamGames(games, season, team) {
  return games
    .filter((g) => g.season === season && (g.homeTeam === team || g.awayTeam === team))
    .sort((a, b) => a.week - b.week);
}

function isCompleted(g, todayStr) {
  return (g.homeScore != null && g.awayScore != null) || (!!g.gameday && g.gameday < todayStr);
}

/** Current season (latest that has started), the team, and its most recent completed game. */
function defaultSelection(games, { team = 'BAL', today = new Date() } = {}) {
  const todayStr = isoDate(today);
  const all = seasons(games);
  const started = games.filter((g) => g.gameday && g.gameday <= todayStr);
  const season = started.length ? Math.max(...started.map((g) => g.season)) : all[0];
  const tg = teamGames(games, season, team);
  const done = tg.filter((g) => isCompleted(g, todayStr));
  const g = done.length ? done[done.length - 1] : tg[0];
  return { season, team, week: g ? g.week : null, gameId: g ? g.gameId : null };
}

const ROUND_NAMES = { WC: 'Wild Card', DIV: 'Divisional', CON: 'Conference', SB: 'Super Bowl' };

function gameLabel(g, team) {
  const home = g.homeTeam === team;
  const opp = home ? g.awayTeam : g.homeTeam;
  const wk = g.gameType && g.gameType !== 'REG' ? ROUND_NAMES[g.gameType] || g.gameType : `Week ${g.week}`;
  let res = '';
  if (g.homeScore != null && g.awayScore != null) {
    const us = home ? g.homeScore : g.awayScore;
    const them = home ? g.awayScore : g.homeScore;
    res = ` (${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}-${them})`;
  }
  return `${wk} ${home ? 'vs' : '@'} ${opp}${res}`;
}

module.exports = { parseGames, isoDate, seasons, teamsInSeason, teamGames, defaultSelection, gameLabel, isCompleted };
