(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).clipExport = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const START_PAD = 0.008;
  const END_TRIM_FRAMES = 3; // Detected cuts can be late; avoid flashing the next shot.
  const MODES = ['sideline', 'endzone', 'both'];

  function clipRange(pair, fps, offset = 0) {
    if (!pair || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(offset)) {
      throw new Error('Invalid clip timing');
    }
    const aStart = pair.sideline.start + START_PAD;
    const bStart = pair.endzone.start + START_PAD + offset / fps;
    const len = Math.min(pair.sideline.end - aStart, pair.endzone.end - bStart) - END_TRIM_FRAMES / fps;
    if (![aStart, bStart, len].every(Number.isFinite) || aStart < 0 || bStart < 0 || len <= 0) {
      throw new Error('The sync offset leaves no usable clip. Reset the offset before exporting.');
    }
    return { aStart, bStart, len };
  }

  function selectedIndices(selected) {
    return [...selected].sort((a, b) => a - b);
  }

  function selectionRange(visible, anchor, target) {
    const end = visible.indexOf(target);
    if (end < 0) return [];
    const start = visible.indexOf(anchor);
    return start < 0 ? [target] : visible.slice(Math.min(start, end), Math.max(start, end) + 1);
  }

  function safeFilename(name) {
    const stem = String(name || 'A22-clip').replace(/\.mp4$/i, '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/→/g, '-to-').replace(/−/g, '-')
      .replace(/[^a-zA-Z0-9._+-]+/g, '-').replace(/-+/g, '-')
      .replace(/^[.\-]+|[.\-]+$/g, '').slice(0, 180).replace(/[.\-]+$/g, '') || 'A22-clip';
    return `${/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem) ? 'A22-' : ''}${stem}.mp4`;
  }

  function exportFilename(plays) {
    const clock = (p) => p ? `${p.qtr >= 5 ? `OT${p.qtr === 5 ? '' : p.qtr - 4}` : `Q${p.qtr || ''}`}-${String(p.time || '').replace(':', 'm')}s` : '';
    let detail = 'clip';
    if (plays.length === 1) {
      const p = plays[0];
      const names = p.names || {};
      const player = names.rusher || (p.flags?.complete_pass && names.receiver) || names.passer ||
        names.returner || names.kicker || names.punter || names.receiver;
      const yards = Number.isFinite(p.yards) ? `${p.yards < 0 ? 'minus' : ''}${Math.abs(p.yards)}yds` : '';
      detail = [clock(p), player, yards].filter(Boolean).join('-');
    } else if (plays.length > 1) {
      detail = `${clock(plays[0])}-to-${clock(plays[plays.length - 1])}`;
    }
    return safeFilename(detail);
  }

  function dimensions(mode) {
    if (!MODES.includes(mode)) throw new Error('Choose a valid export angle');
    return mode === 'both' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  }

  return { START_PAD, END_TRIM_FRAMES, MODES, clipRange, selectedIndices, selectionRange, safeFilename, exportFilename, dimensions };
});
