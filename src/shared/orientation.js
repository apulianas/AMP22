'use strict';

/**
 * Edge-orientation features of a grayscale frame. End zone shots are dominated by
 * horizontal yard lines; sideline shots by vertical/diagonal ones.
 * score = (horizontalEdges - verticalEdges) / allEdges, in [-1, 1]; higher = more "end zone".
 */
function features(gray, w, h, { magThreshold = 60, ratio = 2, margin = 0.08 } = {}) {
  let hc = 0;
  let vc = 0;
  let dc = 0;
  const x0 = Math.max(1, Math.floor(w * margin));
  const x1 = Math.min(w - 1, w - Math.floor(w * margin));
  const y0 = Math.max(1, Math.floor(h * margin));
  const y1 = Math.min(h - 1, h - Math.floor(h * margin));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1]);
      const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1]);
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      if (ax + ay < magThreshold) continue;
      if (ay > ratio * ax) hc++;
      else if (ax > ratio * ay) vc++;
      else dc++;
    }
  }
  const total = hc + vc + dc;
  return { horizontal: hc, vertical: vc, diagonal: dc, edges: total, score: total ? (hc - vc) / total : 0 };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 1-D 2-means on the raw scores. Returns values normalised so the two clusters sit
 * near -1 and +1 (clamped to ±3). Non-numbers and degenerate inputs map to 0.
 */
function normalizeScores(values) {
  const vals = values.filter((v) => typeof v === 'number' && isFinite(v));
  if (vals.length < 4) return { mid: 0, spread: 0, normalized: values.map(() => 0) };
  let c1 = Math.min(...vals);
  let c2 = Math.max(...vals);
  for (let it = 0; it < 100; it++) {
    let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
    for (const v of vals) {
      if (Math.abs(v - c1) <= Math.abs(v - c2)) { s1 += v; n1++; } else { s2 += v; n2++; }
    }
    const nc1 = n1 ? s1 / n1 : c1;
    const nc2 = n2 ? s2 / n2 : c2;
    if (nc1 === c1 && nc2 === c2) break;
    c1 = nc1;
    c2 = nc2;
  }
  const mid = (c1 + c2) / 2;
  const spread = (c2 - c1) / 2;
  const ok = spread > 0.02;
  return {
    mid,
    spread,
    normalized: values.map((v) => (ok && typeof v === 'number' && isFinite(v) ? clamp((v - mid) / spread, -3, 3) : 0)),
  };
}

module.exports = { features, normalizeScores, clamp };
