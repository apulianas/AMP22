'use strict';

const { aliases } = require('./teams');

const VIDEO_EXT = /\.(mp4|m4v|mov|mkv)$/i;

function isA22Name(p) {
  const base = p.split(/[\\/]/).pop();
  return /a-?22|all-?22/i.test(base);
}

function weekTokens(relPath) {
  const out = [];
  const re = /(?:^|[^a-z0-9])(?:w|wk|week)[ _-]?0*(\d{1,2})(?!\d)/gi;
  let m;
  while ((m = re.exec(relPath))) out.push(Number(m[1]));
  return out;
}

/**
 * Scores how well a film path matches a game. Higher is better.
 * @param {string} relPath path relative to the film root
 * @param {{week:number, opponent:string, season?:number}} game
 */
function scoreCandidate(relPath, game) {
  let score = 0;
  if (isA22Name(relPath)) score += 3;
  const weeks = weekTokens(relPath);
  if (weeks.includes(game.week)) score += 3;
  else if (weeks.length) score -= 5;
  const lower = relPath.toLowerCase();
  if (game.opponent && aliases(game.opponent).some((a) => lower.includes(a.toLowerCase()))) score += 3;
  if (game.season && relPath.includes(String(game.season))) score += 1;
  return score;
}

/** Returns candidates sorted best-first, plus `auto` when one clear winner exists. */
function rankCandidates(relPaths, game) {
  const ranked = relPaths
    .map((p) => ({ path: p, score: scoreCandidate(p, game), a22: isA22Name(p) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const auto = ranked.length && ranked[0].score >= 6 && (ranked.length === 1 || ranked[1].score < ranked[0].score) ? ranked[0].path : null;
  return { ranked, auto };
}

module.exports = { VIDEO_EXT, isA22Name, weekTokens, scoreCandidate, rankCandidates };
