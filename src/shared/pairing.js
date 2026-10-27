'use strict';

const { normalizeScores } = require('./orientation');

const DEFAULTS = {
  minClip: 1.5, // clips shorter than this can't be a pair half on their own
  shortClip: 3, // skipping short clips (graphics, flashes) is cheap
  base: 3,
  durWeight: 4,
  orientWeight: 1,
  skipCost: 2,
  shortSkipCost: 0.2,
  mergeCost: 1.5, // penalty for merging two adjacent clips into one half (spurious cut)
};

function span(clips, a, b) {
  return { start: clips[a].start, end: clips[b].end, clips: Array.from({ length: b - a + 1 }, (_, k) => clips[a + k].index) };
}

/**
 * Groups consecutive clips into (sideline, end zone) pairs with dynamic programming.
 * Each half may span 1–2 clips (to absorb a spurious cut); clips can be left unpaired.
 * Scoring rewards similar half lengths and sideline→end zone orientation.
 * @param {{start:number,end:number,orient?:number|null}[]} clips
 */
function pairClips(clips, opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const n = clips.length;
  const s = normalizeScores(clips.map((c) => (c.orient == null ? null : c.orient))).normalized;
  const dur = clips.map((c) => c.end - c.start);

  const halfOrient = (a, b) => {
    let tot = 0, w = 0;
    for (let k = a; k <= b; k++) { tot += s[k] * dur[k]; w += dur[k]; }
    return w ? tot / w : 0;
  };
  const halfDur = (a, b) => clips[b].end - clips[a].start;

  // Merged halves must have consistent orientation sign (no-op when orientation unknown).
  const mergeOk = (a, b, wantSign) => {
    for (let k = a; k <= b; k++) if (s[k] * wantSign < 0) return false;
    return true;
  };

  const best = new Float64Array(n + 1);
  const choice = new Array(n + 1).fill(null);
  for (let i = n - 1; i >= 0; i--) {
    let b = best[i + 1] - (dur[i] < o.shortClip ? o.shortSkipCost : o.skipCost);
    let c = { type: 'skip' };
    for (let ls = 1; ls <= 2; ls++) {
      for (let le = 1; le <= 2; le++) {
        const sEnd = i + ls - 1;
        const eStart = sEnd + 1;
        const eEnd = eStart + le - 1;
        if (eEnd >= n) continue;
        const ds = halfDur(i, sEnd);
        const de = halfDur(eStart, eEnd);
        if (ds < o.minClip || de < o.minClip) continue;
        if (ls === 2 && !mergeOk(i, sEnd, -1)) continue;
        if (le === 2 && !mergeOk(eStart, eEnd, 1)) continue;
        const r = Math.abs(ds - de) / Math.max(ds, de);
        const orient = Math.max(-4, Math.min(4, halfOrient(eStart, eEnd) - halfOrient(i, sEnd))) / 2;
        const score = o.base - o.durWeight * r + o.orientWeight * orient - o.mergeCost * (ls - 1 + le - 1);
        const total = best[eEnd + 1] + score;
        if (total > b) {
          b = total;
          c = { type: 'pair', sEnd, eEnd, score };
        }
      }
    }
    best[i] = b;
    choice[i] = c;
  }

  const pairs = [];
  let i = 0;
  while (i < n) {
    const c = choice[i];
    if (c.type === 'skip') { i++; continue; }
    pairs.push({
      index: pairs.length,
      sideline: span(clips, i, c.sEnd),
      endzone: span(clips, c.sEnd + 1, c.eEnd),
      score: Math.round(c.score * 100) / 100,
    });
    i = c.eEnd + 1;
  }
  return pairs;
}

module.exports = { pairClips, DEFAULTS };
