(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).tracking = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RATE = 10;
  const MAX_SECONDS = 60;
  const MAX_POINTS = MAX_SECONDS * RATE + 2;
  const DEFAULTS = { mode: 'full', radius: 0.035, showName: true, showPhoto: true };

  function defaults(value = {}) {
    return {
      mode: ['full', 'presnap'].includes(value.mode) ? value.mode : DEFAULTS.mode,
      radius: Number.isFinite(value.radius) && value.radius >= 0.015 && value.radius <= 0.1 ? value.radius : DEFAULTS.radius,
      showName: typeof value.showName === 'boolean' ? value.showName : DEFAULTS.showName,
      showPhoto: typeof value.showPhoto === 'boolean' ? value.showPhoto : DEFAULTS.showPhoto,
    };
  }

  function validateTrack(track) {
    if (!track || !['full', 'presnap'].includes(track.mode) ||
        !Number.isFinite(track.radius) || track.radius < 0.015 || track.radius > 0.1 ||
        typeof track.name !== 'string' || track.name.length > 100 ||
        typeof track.showName !== 'boolean' || typeof track.showPhoto !== 'boolean' ||
        (track.id !== null && (typeof track.id !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(track.id))) ||
        (track.snap !== null && (!Number.isFinite(track.snap) || track.snap < 0)) ||
        !Array.isArray(track.points) || track.points.length > MAX_POINTS) throw new Error('Invalid player highlight.');
    let previous = -1;
    for (const point of track.points) {
      if (!point || ![point.t, point.x, point.y].every(Number.isFinite) || point.t <= previous ||
          point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error('Invalid highlight track points.');
      previous = point.t;
    }
    return track;
  }

  function position(points, time) {
    if (!points.length || time < points[0].t || time > points[points.length - 1].t + 0.051) return null;
    let i = points.findIndex(point => point.t > time);
    if (i < 0) return points[points.length - 1];
    if (i === 0) return null;
    const a = points[i - 1], b = points[i];
    if (b.t - a.t > 0.151) return time - a.t <= 0.051 ? a : null;
    const fraction = (time - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
  }

  function visible(track, time) {
    return track.mode !== 'presnap' || (track.snap !== null && time < track.snap);
  }

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function cameraShift(previous, next, width, height, players) {
    const samples = [];
    for (let y = 16; y < height - 16; y += 12) for (let x = 16; x < width - 16; x += 12) {
      if (players.some(p => Math.hypot(p.x - x, p.y - y) < 22)) continue;
      const index = y * width + x;
      const gradient = Math.abs(previous[index] - previous[index - 2]) + Math.abs(previous[index] - previous[index - width * 2]);
      if (gradient >= 18) samples.push({ index, value: previous[index] });
    }
    if (samples.length < 24) return null;
    const candidates = [];
    // Field markings can be individually ambiguous. Register them together, capping
    // per-pixel error so unmarked moving players do not dominate the camera estimate.
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
      const offset = dy * width + dx;
      let total = 0;
      for (const sample of samples) total += Math.min(40, Math.abs(next[sample.index + offset] - sample.value));
      candidates.push({ x: dx, y: dy, score: total / samples.length });
    }
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];
    const rival = candidates.find(p => Math.hypot(p.x - best.x, p.y - best.y) > 2);
    if (best.score > 12 || !rival || rival.score - best.score < 0.5) return null;
    return { x: best.x, y: best.y };
  }

  function patchMotion(previous, next, width, height, point, shift) {
    const x = Math.round(point.x), y = Math.round(point.y);
    const nx = Math.round(point.x + shift.x), ny = Math.round(point.y + shift.y);
    if (Math.min(x, nx) < 4 || Math.max(x, nx) >= width - 4 ||
        Math.min(y, ny) < 6 || Math.max(y, ny) >= height - 6) return null;
    const differences = [];
    for (let dy = -6; dy <= 6; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
      differences.push(next[(ny + dy) * width + nx + dx] - previous[(y + dy) * width + x + dx]);
    }
    const brightness = median(differences);
    return differences.reduce((sum, d) => sum + Math.abs(d - brightness), 0) / differences.length;
  }

  function suggestSnap(samples, count) {
    if (count < 3) return null;
    // Require a settled baseline and sustained, coordinated movement, not a single motion player.
    let settled = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      const sample = samples[i], next = samples[i + 1];
      if (!sample.camera || sample.speeds.length !== count || !sample.speeds.every(Number.isFinite)) { settled = 0; continue; }
      const fraction = sample.speeds.filter(v => v >= 1.2).length / count;
      if (fraction <= 0.2) { settled++; continue; }
      if (settled >= 4 && fraction >= 0.6 && next.camera && next.speeds.length === count && next.speeds.every(Number.isFinite) &&
          next.speeds.filter(v => v >= 1.2).length / count >= 0.6) {
        return { time: sample.t - 1 / RATE, confidence: fraction >= 0.8 ? 'higher' : 'moderate', players: count };
      }
      settled = 0;
    }
    return null;
  }

  function geometry(mode, angle, info, centered) {
    const box = mode === 'both' ? { w: 1080, h: 608 } : { w: 1920, h: 1080 };
    const scale = Math.min(box.w / info.width, box.h / info.height);
    const w = Math.round(info.width * scale), h = Math.round(info.height * scale);
    return {
      x: (box.w - w) / 2,
      y: (box.h - h) / 2 + (mode === 'both' ? (centered ? 352 : 0) + (angle === 'endzone' ? 608 : 0) : 0),
      w, h,
    };
  }

  function intervals(track, start, len) {
    const end = Math.min(start + len, track.mode === 'presnap' ? track.snap ?? start : Infinity);
    const result = [];
    for (let i = 0; i < track.points.length; i++) {
      const a = track.points[i], b = track.points[i + 1];
      const stop = b && b.t - a.t <= 0.151 ? b.t : a.t + 0.05;
      if (a.t < end && stop > start) result.push({ a, b: b && b.t - a.t <= 0.151 ? b : a, from: Math.max(start, a.t) - start, to: Math.min(end, stop) - start });
    }
    return result;
  }

  return { RATE, MAX_SECONDS, MAX_POINTS, DEFAULTS, defaults, validateTrack, position, visible, cameraShift, patchMotion, suggestSnap, geometry, intervals };
});
