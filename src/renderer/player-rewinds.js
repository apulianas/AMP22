/* global A22 */
(function () {
  'use strict';
  const R = A22.rewind;
  const $ = id => document.getElementById(`highlight-${id}`);
  const fixed = value => Number(value.toFixed(2));

  // Rewind markers above the scrubber, one coloured lane per rewind below it, and the small editor
  // that opens from a marker. The playhead model and playback live in player-highlights.js.
  A22.createRewindTimeline = function (options) {
    let openId = null;
    const host = $('rewind-timeline'), markers = $('rewind-markers'), lanes = $('rewind-lanes'), popover = $('rewind-popover');
    const clip = () => options.clip();
    const locked = () => !clip() || !!options.locked();
    const ratio = seconds => Math.max(0, Math.min(1, seconds / clip().len));

    function status(message, error = false) {
      $('rewind-status').textContent = message;
      $('rewind-status').classList.toggle('error', error);
    }
    function entries() {
      const c = clip();
      return (c?.rewinds || []).map((rewind, index) => ({
        rewind, index, number: rewind.color + 1, color: R.COLORS[rewind.color],
        effective: R.effective(rewind, c.trim, c.trimEnd ?? 0, c.len, c.fps),
      }));
    }
    function describe(entry) {
      const { effective, rewind } = entry;
      if (!effective) return 'This rewind is outside the trimmed play and is ignored in the export.';
      const added = effective.seconds + effective.seconds / effective.speed;
      return `Plays back ${fixed(effective.seconds)}s of footage in ${fixed(effective.seconds / effective.speed)}s, then replays it. Adds ${fixed(added)}s to the clip.${
        effective.seconds < rewind.seconds - 0.001 ? ' Shortened to the footage left after the trim.' : ''}`;
    }
    function marker(entry, c) {
      const { rewind, effective, number, color } = entry;
      const turn = effective ? R.span({ ...effective }, c.fps).turn : Math.max(0, rewind.at - 1 / c.fps);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `rewind-marker${effective ? '' : ' inactive'}${rewind.id === openId ? ' open' : ''}`;
      button.dataset.id = rewind.id;
      button.style.setProperty('--position', ratio(turn));
      button.style.setProperty('--rewind-color', color);
      button.textContent = `◀◀ ${number}`;
      button.title = effective ? `Rewind ${number}: ${fixed(effective.seconds)}s at ${effective.speed}×. Click to edit.`
        : `Rewind ${number} is outside the trimmed play and is ignored.`;
      button.setAttribute('aria-label', `Rewind ${number}, ${fixed(rewind.seconds)} seconds at ${rewind.speed} times speed${effective ? '' : ', ignored by the current trim'}. Edit rewind`);
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', String(rewind.id === openId));
      button.addEventListener('click', () => (rewind.id === openId ? close(true) : open(rewind.id)));
      return button;
    }
    function band(entry, c) {
      const { rewind, effective, color } = entry;
      const range = effective ? R.span({ ...effective }, c.fps) : { start: Math.max(0, rewind.at - rewind.seconds), end: Math.min(c.len, rewind.at) };
      const lane = document.createElement('span');
      lane.className = `rewind-band${effective ? '' : ' inactive'}`;
      lane.style.setProperty('--from', ratio(range.start));
      lane.style.setProperty('--to', ratio(range.end));
      lane.style.setProperty('--rewind-color', color);
      lane.title = `Rewind ${entry.number} replays this part of the play`;
      return lane;
    }
    function sync() {
      const c = clip(), list = entries();
      host.hidden = !c;
      $('add-rewind').disabled = locked();
      markers.replaceChildren(...(c ? list.map(entry => marker(entry, c)) : []));
      lanes.replaceChildren(...(c ? list.map(entry => band(entry, c)) : []));
      lanes.hidden = !list.length;
      if (openId !== null && !list.some(entry => entry.rewind.id === openId)) openId = null;
      popover.hidden = openId === null;
      if (openId !== null) fill(list.find(entry => entry.rewind.id === openId), c);
    }
    function fill(entry, c) {
      const { rewind, effective } = entry;
      popover.style.setProperty('--rewind-color', entry.color);
      $('rewind-title').textContent = `Rewind ${entry.number}`;
      const room = R.maxSeconds(rewind.at, c.trim, c.fps);
      $('rewind-seconds').max = Math.max(1 / c.fps, room);
      $('rewind-seconds').min = fixed(Math.min(1 / c.fps, room));
      for (const [field, value] of [['seconds', fixed(rewind.seconds)], ['speed', rewind.speed]]) {
        if (document.activeElement !== $('rewind-' + field)) $('rewind-' + field).value = value;
        $('rewind-' + field).disabled = locked();
      }
      $('rewind-delete').disabled = locked();
      $('rewind-summary').textContent = describe(entry);
      $('rewind-seconds-hint').textContent = `· up to ${fixed(Math.max(0, room))}`;
      $('rewind-seconds').title = `Up to ${fixed(Math.max(0, room))}s: ${R.MAX_SECONDS}s at most, or back to the start of the play.`;
      const width = host.clientWidth || 0, popoverWidth = Math.min(440, width);
      const center = 7 + (width - 14) * ratio(effective ? R.span({ ...effective }, c.fps).turn : rewind.at);
      const left = Math.max(0, Math.min(width - popoverWidth, center - popoverWidth / 2));
      popover.style.left = `${left}px`;
      popover.style.setProperty('--pointer', `${center - left}px`);
    }
    function open(id) {
      openId = id;
      sync();
      $('rewind-seconds').focus();
      popover.scrollIntoView?.({ block: 'nearest' });
    }
    function close(restoreFocus = false) {
      const id = openId;
      openId = null;
      sync();
      if (restoreFocus && id !== null) markers.querySelector?.(`[data-id="${id}"]`)?.focus();
      return id !== null;
    }
    function current() {
      return entries().find(entry => entry.rewind.id === openId);
    }
    function changed() {
      options.changed();
      sync();
    }
    function add() {
      const c = clip();
      if (!c || options.locked()) return;
      if (!options.ready()) { status('Wait for the selected frame to finish loading before adding a rewind.', true); return; }
      options.pause();
      // The frame on screen is the last one shown before the video rewinds.
      const frame = Math.floor(options.playhead() * c.fps + 0.05);
      if (frame < Math.round(c.trim * c.fps) || (frame + 1) / c.fps > c.len - (c.trimEnd ?? 0) + 1e-6) {
        status('Move the playhead inside the retained (blue) part of the play before adding a rewind.', true);
        return;
      }
      try {
        c.rewinds ||= [];
        const rewind = R.create(c.rewinds, (frame + 1) / c.fps, c.trim, c.fps);
        c.rewinds.push(rewind);
        status(`Rewind ${rewind.color + 1} added. Adjust its length or speed in the editor, or delete it.`);
        open(rewind.id);
        changed();
      } catch (error) {
        status(error.message, true);
      }
    }
    function edit(field) {
      const entry = current(), c = clip();
      if (!entry || locked()) return false;
      const input = $('rewind-' + field), value = input.valueAsNumber;
      const [min, max] = field === 'seconds' ? [Math.min(1 / c.fps, R.maxSeconds(entry.rewind.at, c.trim, c.fps)), R.maxSeconds(entry.rewind.at, c.trim, c.fps)]
        : [R.MIN_SPEED, R.MAX_SPEED];
      return { entry, input, value, min, max };
    }
    for (const field of ['seconds', 'speed']) {
      $('rewind-' + field).addEventListener('input', () => {
        const state = edit(field);
        if (!state || !Number.isFinite(state.value) || state.value < state.min - 1e-9 || state.value > state.max + 1e-9) return;
        state.entry.rewind[field] = field === 'speed' ? state.value : Math.round(state.value * 1e6) / 1e6;
        changed();
      });
      $('rewind-' + field).addEventListener('change', () => {
        const state = edit(field);
        if (!state) return;
        const value = Number.isFinite(state.value) ? Math.min(state.max, Math.max(state.min, state.value))
          : field === 'speed' ? R.DEFAULT_SPEED : state.entry.rewind.seconds;
        state.entry.rewind[field] = field === 'speed' ? R.clampSpeed(value) : value;
        state.input.value = field === 'seconds' ? fixed(state.entry.rewind.seconds) : state.entry.rewind.speed;
        changed();
      });
    }
    $('rewind-delete').addEventListener('click', () => {
      const entry = current();
      if (!entry || locked()) return;
      const c = clip();
      c.rewinds.splice(c.rewinds.indexOf(entry.rewind), 1);
      openId = null;
      status(`Rewind ${entry.number} deleted.`);
      changed();
      $('add-rewind').focus();
    });
    $('rewind-close').addEventListener('click', () => close(true));
    popover.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    });
    document.addEventListener('pointerdown', event => {
      if (openId === null) return;
      if (popover.contains(event.target) || event.target.closest?.('.rewind-marker')) return;
      close();
    });
    $('add-rewind').addEventListener('click', add);

    return { sync, close, add, status, open: id => open(id) };
  };
})();
