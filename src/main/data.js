'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseCSV } = require('../shared/csv');
const schedule = require('../shared/schedule');
const plays = require('../shared/plays');

const GAMES_URL = 'https://github.com/nflverse/nfldata/raw/master/data/games.csv';
const PBP_URL = (y) => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${y}.csv.gz`;
const HOUR = 3600e3;

/** Downloads and caches nflverse schedule + play-by-play for offline use. */
class DataService {
  constructor(cacheDir, fetchImpl = globalThis.fetch) {
    this.dir = cacheDir;
    this.fetch = fetchImpl;
    this.games = null;
    this.pbp = new Map(); // season -> {mtimeMs, games: {gameId: rows[]}}
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  /** Returns {path, warning?}. Re-downloads when older than maxAge (or force); falls back to stale cache. */
  async cached(url, name, maxAgeMs, force) {
    const file = path.join(this.dir, name);
    let st = null;
    try { st = fs.statSync(file); } catch { /* not cached */ }
    if (st && !force && Date.now() - st.mtimeMs < maxAgeMs) return { path: file };
    try {
      const res = await this.fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
      return { path: file };
    } catch (e) {
      if (st) return { path: file, warning: `Offline? Using cached data from ${new Date(st.mtimeMs).toLocaleString()} (${e.message})` };
      throw new Error(`Could not download ${url}: ${e.message}`);
    }
  }

  async loadSchedule({ force = false } = {}) {
    const r = await this.cached(GAMES_URL, 'games.csv', 12 * HOUR, force);
    const mtimeMs = fs.statSync(r.path).mtimeMs;
    if (!this.games || this.games.mtimeMs !== mtimeMs) {
      const { rows } = parseCSV(fs.readFileSync(r.path, 'utf8'), {
        columns: ['game_id', 'season', 'game_type', 'week', 'gameday', 'away_team', 'home_team', 'away_score', 'home_score'],
      });
      this.games = { mtimeMs, list: schedule.parseGames(rows) };
    }
    return { games: this.games.list, warning: r.warning };
  }

  async loadSeasonPbp(season, { force = false, current = true } = {}) {
    const r = await this.cached(PBP_URL(season), `play_by_play_${season}.csv.gz`, current ? 3 * HOUR : 30 * 24 * HOUR, force);
    const srcMtime = fs.statSync(r.path).mtimeMs;
    const mem = this.pbp.get(season);
    if (mem && mem.mtimeMs === srcMtime) return { data: mem, warning: r.warning };

    const jsonFile = path.join(this.dir, `pbp_${season}.json`);
    try {
      const j = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      if (j.mtimeMs === srcMtime && j.columns === plays.PBP_COLUMNS.join(',')) {
        this.pbp.set(season, j);
        return { data: j, warning: r.warning };
      }
    } catch { /* rebuild */ }

    const text = zlib.gunzipSync(fs.readFileSync(r.path)).toString('utf8');
    const { rows } = parseCSV(text, { columns: plays.PBP_COLUMNS });
    const games = {};
    for (const row of rows) (games[row.game_id] = games[row.game_id] || []).push(row);
    const data = { mtimeMs: srcMtime, columns: plays.PBP_COLUMNS.join(','), games };
    fs.writeFileSync(jsonFile, JSON.stringify(data));
    this.pbp.set(season, data);
    return { data, warning: r.warning };
  }

  /** Normalized real plays for one game. */
  async loadGamePlays(season, gameId, opts = {}) {
    const { data, warning } = await this.loadSeasonPbp(season, opts);
    const rows = data.games[gameId];
    if (!rows) return { plays: [], warning: warning || `No play-by-play yet for ${gameId}` };
    return { plays: plays.gamePlays(rows), warning };
  }
}

module.exports = { DataService, GAMES_URL, PBP_URL };
