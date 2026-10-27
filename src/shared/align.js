(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).align = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COSTS = {
    missingFilm: 3, // play expected on film (weight 1) left without a clip
    spuriousFilm: 3, // play not expected on film (weight 0) given a clip
    skipPair: 2, // film clip with no play in the play-by-play
    edgePair: 1, // unmatched clips before the first / after the last play (intros, etc.)
  };

  /**
   * Edit-distance style alignment of plays to a run of film pairs.
   * @param {number[]} filmed probability (0–1) that each play appears on film
   * @param {number} m number of pairs
   * @returns {(number|null)[]} pair index (0..m-1) per play
   */
  function alignSegment(filmed, m, { leadCost = COSTS.edgePair, trailCost = COSTS.edgePair, costs = COSTS } = {}) {
    const n = filmed.length;
    const W = m + 1;
    const D = new Float64Array((n + 1) * W);
    const C = new Uint8Array((n + 1) * W); // 1 match, 2 skip play, 3 skip pair
    for (let j = 1; j <= m; j++) { D[j] = j * leadCost; C[j] = 3; }
    for (let i = 1; i <= n; i++) {
      const w = Math.min(1, Math.max(0, Number(filmed[i - 1]) || 0));
      const sp = w * costs.missingFilm;
      const mc = (1 - w) * costs.spuriousFilm;
      D[i * W] = D[(i - 1) * W] + sp;
      C[i * W] = 2;
      for (let j = 1; j <= m; j++) {
        let best = D[(i - 1) * W + j - 1] + mc;
        let c = 1;
        const a = D[(i - 1) * W + j] + sp;
        if (a < best - 1e-9) { best = a; c = 2; }
        const b = D[i * W + j - 1] + costs.skipPair;
        if (b < best - 1e-9) { best = b; c = 3; }
        D[i * W + j] = best;
        C[i * W + j] = c;
      }
    }
    let bj = 0;
    let bv = Infinity;
    for (let j = 0; j <= m; j++) {
      const v = D[n * W + j] + (m - j) * trailCost;
      if (v < bv - 1e-9) { bv = v; bj = j; }
    }
    const out = new Array(n).fill(null);
    let i = n;
    let j = bj;
    while (i > 0) {
      const c = C[i * W + j];
      if (c === 1) { out[i - 1] = j - 1; i--; j--; }
      else if (c === 2) { i--; }
      else { j--; }
    }
    return out;
  }

  /**
   * Aligns all plays to pairs, honouring user anchors.
   * @param {{filmWeight:number}[]} plays
   * @param {number} pairCount
   * @param {Map<number, number|null>|Object} anchors playIndex -> pairIndex (or null = no film)
   */
  function alignPlays(plays, pairCount, anchors) {
    const n = plays.length;
    const entries = anchors instanceof Map ? [...anchors.entries()] : Object.entries(anchors || {});
    const forcedNull = new Set();
    const fixed = [];
    for (const [k, v] of entries) {
      const pi = Number(k);
      if (!(pi >= 0 && pi < n)) continue;
      if (v === null) forcedNull.add(pi);
      else if (Number.isInteger(v) && v >= 0 && v < pairCount) fixed.push([pi, v]);
    }
    fixed.sort((a, b) => a[0] - b[0]);
    const kept = [];
    for (const f of fixed) {
      const last = kept[kept.length - 1];
      if (forcedNull.has(f[0])) continue;
      if (!last || (f[1] > last[1])) kept.push(f);
    }

    const result = new Array(n).fill(null);
    let prevPlay = -1;
    let prevPair = -1;
    const bounds = [...kept, [n, pairCount]];
    bounds.forEach(([p, q], bi) => {
      const idx = [];
      for (let k = prevPlay + 1; k < p; k++) if (!forcedNull.has(k)) idx.push(k);
      const seg = alignSegment(idx.map((k) => plays[k].filmWeight), q - prevPair - 1, {
        leadCost: prevPlay === -1 ? COSTS.edgePair : COSTS.skipPair,
        trailCost: bi === bounds.length - 1 ? COSTS.edgePair : COSTS.skipPair,
      });
      seg.forEach((v, k) => { result[idx[k]] = v === null ? null : prevPair + 1 + v; });
      if (p < n) result[p] = q;
      prevPlay = p;
      prevPair = q;
    });
    return result;
  }

  return { alignSegment, alignPlays, COSTS };
});
