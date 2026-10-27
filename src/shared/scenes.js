'use strict';

/**
 * Parses output of ffmpeg's `metadata=print:key=lavfi.scene_score` filter, either
 * from stderr (lines prefixed with "[Parsed_metadata_N @ 0x..]") or from a file.
 * Returns a line handler; calls onScore({time, score}) for each scored frame.
 */
function createMetadataParser(onScore) {
  let pending = null;
  return function handleLine(line) {
    let m = /pts_time:\s*(-?[\d.]+(?:e[-+]?\d+)?)/i.exec(line);
    if (m) {
      pending = parseFloat(m[1]);
      return;
    }
    m = /lavfi\.scene_score=\s*([\d.]+(?:e[-+]?\d+)?)/i.exec(line);
    if (m && pending !== null) {
      onScore({ time: pending, score: parseFloat(m[1]) });
      pending = null;
    }
  };
}

function parseMetadataLog(text) {
  const out = [];
  const handle = createMetadataParser((s) => out.push(s));
  text.split(/\r?\n/).forEach(handle);
  return out;
}

/** Splits a stream of text chunks into lines. */
function createLineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      const parts = buf.split(/\r?\n|\r/);
      buf = parts.pop();
      for (const p of parts) onLine(p);
    },
    end() {
      if (buf) onLine(buf);
      buf = '';
    },
  };
}

/** Picks cut times from scene scores; cuts closer than minGap are merged (highest score wins). */
function cutsFromScores(scores, { threshold = 0.1, minGap = 0.4 } = {}) {
  const sorted = scores.filter((s) => s.score >= threshold && s.time > 0).sort((a, b) => a.time - b.time);
  const cuts = [];
  for (const s of sorted) {
    const last = cuts[cuts.length - 1];
    if (last && s.time - last.time < minGap) {
      if (s.score > last.score) cuts[cuts.length - 1] = { time: s.time, score: s.score };
    } else {
      cuts.push({ time: s.time, score: s.score });
    }
  }
  return cuts;
}

/** Turns cut times into contiguous clips covering [0, duration]. */
function clipsFromCuts(cutTimes, duration) {
  const bounds = [0, ...cutTimes.filter((t) => t > 0 && t < duration).sort((a, b) => a - b), duration];
  const clips = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (bounds[i + 1] - bounds[i] <= 0) continue;
    clips.push({ index: clips.length, start: bounds[i], end: bounds[i + 1], duration: bounds[i + 1] - bounds[i] });
  }
  return clips;
}

function parseRate(rate) {
  if (typeof rate === 'number') return rate;
  if (!rate) return null;
  const [a, b] = String(rate).split('/').map(Number);
  if (!b) return isFinite(a) && a > 0 ? a : null;
  const r = a / b;
  return isFinite(r) && r > 0 ? r : null;
}

module.exports = { createMetadataParser, parseMetadataLog, createLineSplitter, cutsFromScores, clipsFromCuts, parseRate };
