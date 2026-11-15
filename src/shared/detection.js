'use strict';

const scenes = require('./scenes');
const { pairClips } = require('./pairing');
const { alignPlays } = require('./align');

/** Cut thresholds automatic detection may choose, most to least sensitive. */
const CUT_LEVELS = [0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.1, 0.12, 0.15];
const MIN_CUT_THRESHOLD = CUT_LEVELS[0];
const STANDARD_CUT_THRESHOLD = 0.1;
const MIN_GAP = 0.4;

/** Duration-weighted orientation of [start, end) from finer, already classified clips. */
function blendedOrient(fineClips, start, end) {
  let total = 0;
  let weight = 0;
  for (const c of fineClips) {
    if (c.end <= start || c.orient == null) continue;
    if (c.start >= end) break;
    const overlap = Math.min(end, c.end) - Math.max(start, c.start);
    if (overlap > 0) {
      total += c.orient * overlap;
      weight += overlap;
    }
  }
  return weight ? Math.round((total / weight) * 1000) / 1000 : null;
}

function clipsAtThreshold(candidates, duration, threshold) {
  const cuts = scenes.cutsFromScores(candidates, { threshold, minGap: MIN_GAP });
  return scenes.clipsFromCuts(cuts.map((c) => c.time), duration);
}

/**
 * Rebuilds clips at a coarser threshold, reusing orientation from the finest classified clips.
 * Clips that exactly match a fine clip keep its measured orientation.
 */
function estimateClips(candidates, fineClips, duration, threshold) {
  const exact = new Map(fineClips.map((c) => [`${c.start}|${c.end}`, c]));
  return clipsAtThreshold(candidates, duration, threshold).map((clip) => {
    const same = exact.get(`${clip.start}|${clip.end}`);
    let orient = null;
    if (same) orient = same.orient;
    else if (clip.duration >= 1) orient = blendedOrient(fineClips, clip.start, clip.end);
    return { ...clip, orient, estimated: !same };
  });
}

function validWeights(filmWeights) {
  return Array.isArray(filmWeights) && filmWeights.length > 0
    && filmWeights.every((w) => typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= 1)
    && filmWeights.some((w) => w > 0);
}

/** Scores one threshold by how well its film pairs line up with the play-by-play. */
function evaluateClips(clips, filmWeights) {
  const pairs = pairClips(clips);
  const mapping = alignPlays(filmWeights.map((filmWeight) => ({ filmWeight })), pairs.length, new Map());
  const used = new Set();
  let linked = 0;
  let linkedWeight = 0;
  filmWeights.forEach((w, i) => {
    if (mapping[i] == null) return;
    used.add(mapping[i]);
    linkedWeight += w;
    if (w >= 1) linked++;
  });
  const unusedPairs = pairs.length - used.size;
  return { pairs, linked, unusedPairs, score: linkedWeight - unusedPairs };
}

/**
 * Picks the cut threshold whose film pairs best match the plays expected on film.
 * Each linked play earns its film weight and each film pair left unmatched costs one;
 * ties go to the threshold nearest the standard setting (then the higher one).
 * @param {{candidates:{time:number,score:number}[], fineClips:object[], duration:number,
 *   filmWeights:number[], minThreshold?:number}} input fineClips are classified at minThreshold
 */
function chooseCutThreshold({ candidates, fineClips, duration, filmWeights, minThreshold = MIN_CUT_THRESHOLD }) {
  if (!validWeights(filmWeights)) throw new Error('Automatic cut detection needs play-by-play film weights.');
  const levels = CUT_LEVELS.filter((t) => t >= minThreshold - 1e-9);
  const evaluated = levels.map((threshold) => {
    const clips = estimateClips(candidates, fineClips, duration, threshold);
    return { threshold, clips, ...evaluateClips(clips, filmWeights) };
  });
  const preference = (r) => [Math.abs(r.threshold - STANDARD_CUT_THRESHOLD), -r.threshold];
  const best = evaluated.reduce((a, b) => {
    if (b.score > a.score + 1e-9) return b;
    if (b.score < a.score - 1e-9) return a;
    const [da, ha] = preference(a);
    const [db, hb] = preference(b);
    return db < da - 1e-9 || (Math.abs(db - da) <= 1e-9 && hb < ha) ? b : a;
  });
  return {
    threshold: best.threshold,
    clips: best.clips,
    pairs: best.pairs,
    tuning: {
      surePlays: filmWeights.filter((w) => w >= 1).length,
      possiblePlays: filmWeights.filter((w) => w > 0 && w < 1).length,
      linked: best.linked,
      levels: evaluated.map((r) => ({ threshold: r.threshold, pairs: r.pairs.length, linked: r.linked, unusedPairs: r.unusedPairs })),
    },
  };
}

module.exports = { CUT_LEVELS, MIN_CUT_THRESHOLD, STANDARD_CUT_THRESHOLD, blendedOrient, clipsAtThreshold, estimateClips, validWeights, chooseCutThreshold };
