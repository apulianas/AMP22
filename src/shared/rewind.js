(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).rewind = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_REWINDS = 6;
  const DEFAULT_SECONDS = 2.5;
  const DEFAULT_SPEED = 2;
  const MIN_SPEED = 0.5;
  const MAX_SPEED = 4;
  // Reversing buffers every decoded frame of the rewound span, so keep it bounded.
  const MAX_SECONDS = 6;
  // Distinct from the snap green, trim red and accent blue; each rewind also shows its number.
  const COLORS = ['#f2a900', '#22d3ee', '#a371f7', '#ff79c6', '#d4e157', '#ff8a3d'];

  const round = value => Math.round(value * 1e6) / 1e6;

  function clampSpeed(value) {
    return Number.isFinite(value) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, value)) : DEFAULT_SPEED;
  }

  /** Lowest unused palette slot, so a deleted rewind frees its colour for the next one. */
  function nextColor(rewinds) {
    const used = new Set((rewinds || []).map(r => r.color));
    for (let i = 0; i < COLORS.length; i++) if (!used.has(i)) return i;
    return null;
  }

  /**
   * Whole frames for one rewind: `a` frames play forward before it (the last shown is a - 1), then `d` frames
   * play backwards from a - 2 down to a - 1 - d. Returns null when no earlier frame exists to rewind to.
   */
  function frameCounts(rewind, fps, frames = Infinity) {
    const a = Math.min(frames, Math.round(rewind.at * fps));
    const d = Math.min(Math.round(rewind.seconds * fps), a - 1);
    return d >= 1 ? { a, d } : null;
  }

  /** Time range of the rewound footage, relative to the same origin as `rewind.at`. */
  function span(rewind, fps, frames = Infinity) {
    const counts = frameCounts(rewind, fps, frames);
    if (!counts) return null;
    return { start: (counts.a - 1 - counts.d) / fps, turn: (counts.a - 1) / fps, end: counts.a / fps };
  }

  /**
   * Segments that play a clip with rewinds, in whole frames. Forward segments cover frames [from, to) and
   * reverse segments show frames to - 1 down to from. The last forward segment has no end. Each rewind fires
   * once and playback then resumes forward from the rewound frame, so overlapping rewinds replay footage.
   */
  function plan(rewinds, fps, frames) {
    const ordered = (rewinds || []).map((rewind, index) => ({ rewind, index, counts: frameCounts(rewind, fps, frames) }))
      .filter(item => item.counts).sort((x, y) => x.counts.a - y.counts.a || x.index - y.index);
    const segments = [];
    let cursor = 0;
    for (const { rewind, counts } of ordered) {
      segments.push({ kind: 'forward', from: cursor, to: counts.a });
      segments.push({ kind: 'reverse', from: counts.a - 1 - counts.d, to: counts.a - 1, speed: rewind.speed });
      cursor = counts.a - counts.d;
    }
    segments.push({ kind: 'forward', from: cursor, to: null });
    return segments;
  }

  function hasRewind(rewinds, fps, frames) {
    return (rewinds || []).some(rewind => frameCounts(rewind, fps, frames));
  }

  function outputSeconds(rewinds, fps, frames) {
    return plan(rewinds, fps, frames).reduce((sum, segment) => {
      if (segment.kind === 'reverse') return sum + (segment.to - segment.from) / segment.speed / fps;
      return sum + ((segment.to === null ? frames : segment.to) - segment.from) / fps;
    }, 0);
  }

  function validate(rewinds, len) {
    if (rewinds === undefined) return [];
    if (!Array.isArray(rewinds) || rewinds.length > MAX_REWINDS) throw new Error(`A clip can have at most ${MAX_REWINDS} rewinds.`);
    for (const rewind of rewinds) {
      if (!rewind || ![rewind.at, rewind.seconds, rewind.speed].every(Number.isFinite) ||
          rewind.at <= 0 || rewind.at > len + 0.001 || rewind.seconds <= 0 || rewind.seconds > MAX_SECONDS ||
          rewind.speed < MIN_SPEED || rewind.speed > MAX_SPEED) {
        throw new Error('Invalid rewind. Check its position, duration and speed.');
      }
    }
    return rewinds;
  }

  /** The longest rewind that fits between the trimmed start and `at`. */
  function maxSeconds(at, trim, fps) {
    return Math.max(0, Math.min(MAX_SECONDS, round(at - trim - 1 / fps)));
  }

  function create(rewinds, at, trim, fps) {
    if ((rewinds || []).length >= MAX_REWINDS) throw new Error(`A clip can have at most ${MAX_REWINDS} rewinds.`);
    const available = maxSeconds(at, trim, fps);
    if (available < 1 / fps - 1e-6) throw new Error('A rewind needs footage before it. Move the playhead later in the clip.');
    return { id: `rewind-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, at: round(at),
      seconds: round(Math.min(DEFAULT_SECONDS, available)), speed: DEFAULT_SPEED, color: nextColor(rewinds) };
  }

  /**
   * Rewinds that apply to the trimmed clip, positioned from its new start. A rewind outside the retained
   * range is ignored and a long one is shortened so it never reaches film that was trimmed away.
   */
  function resolve(rewinds, trim, trimEnd, len, fps) {
    const retained = len - trim - trimEnd;
    return (rewinds || []).map(rewind => ({ at: round(rewind.at - trim), seconds: rewind.seconds, speed: rewind.speed }))
      .filter(rewind => rewind.at > 0 && rewind.at <= retained + 1e-6 && frameCounts(rewind, fps))
      .map(rewind => ({ ...rewind, seconds: round(Math.min(rewind.seconds, (frameCounts(rewind, fps).a - 1) / fps)) }));
  }

  /** One rewind as the trimmed clip will play it, still in original-clip time; null when the trims ignore it. */
  function effective(rewind, trim, trimEnd, len, fps) {
    const [resolved] = resolve([rewind], trim, trimEnd, len, fps);
    return resolved ? { ...rewind, seconds: resolved.seconds } : null;
  }

  return { MAX_REWINDS, DEFAULT_SECONDS, DEFAULT_SPEED, MIN_SPEED, MAX_SPEED, MAX_SECONDS, COLORS, clampSpeed, nextColor, frameCounts, span, plan, hasRewind, outputSeconds, validate, maxSeconds, create, resolve, effective };
});
