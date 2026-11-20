'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tracking = require('../src/shared/tracking');
const overlay = require('../src/shared/overlay');
const rewind = require('../src/shared/rewind');

function editor({ deferred = false, mode, renderPreview, snapSupport = false } = {}) {
  const elements = new Map(), requests = [], writes = [], defaults = [], pending = [], cancellations = [], busyChanges = [];
  const animationFrames = new Map(), clock = { now: 0 };
  let frameId = 0;
  let progress;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      listeners: {}, value: '', checked: false, disabled: false, hidden: false, textContent: '',
      readyState: 2, videoWidth: 1920, videoHeight: 1080, currentTime: 10, paused: true,
      classList: { toggle() {} }, src: '', dataset: {},
      style: { setProperty(name, value) { this[name] = value; } },
      setAttribute(name, value) { this[name] = value; },
      get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      fire(name, event = {}) { return this.listeners[name]?.(event); },
      pause() { this.paused = true; }, async play() { this.paused = false; },
      replaceChildren(...children) { this.children = children; }, add() {}, focus() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
      getContext: () => new Proxy({}, { get: () => () => {} }),
      toDataURL: () => 'data:image/png;base64,AAAA',
    });

    return elements.get(id);
  }
  const context = vm.createContext({
    A22: { tracking, overlay, rewind },
    performance: { now: () => clock.now },
    document: { getElementById: element, createElement: () => element('created-canvas'), addEventListener() {} },
    structuredClone,
    requestAnimationFrame(callback) { animationFrames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    Option: function (name, value) { this.name = name; this.value = value; },
    window: { api: {
      onTrackingProgress: callback => { progress = callback; },
      cancelTracking: async () => { cancellations.push(true); },
      trackPlayer: async request => {
        requests.push(request);
        if (deferred) return new Promise((resolve, reject) => pending.push({ resolve, reject, request }));
        return {
          points: [0, 0.1, 0.2].map(t => ({ t: request.start + t, x: 0.5 + t, y: 0.5 })),
          suggestion: { time: request.start + 0.1, confidence: 'moderate', players: 3 }, warnings: [],
        };
      },
    } },
  });
  for (const file of ['player-rewinds.js', 'player-highlights.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context);
  let clean = false, failWrites = false, exporting = false, failSnaps = false;
  const trims = [], rewindChanges = [];
  const snaps = [];
  const instance = context.A22.createHighlightEditor({
    defaults: () => tracking.DEFAULTS, appearance: () => ({ accent: '#aabbcc', background: '#112233', text: '#ffffff', outline: '#000000', opacity: 0.9 }),
    isClean: () => clean, players: () => [], onBusy: value => busyChanges.push(value),
    save: async (clip, value) => { if (failWrites) throw new Error('disk full'); writes.push({ clip, value }); },
    saveDefaults: async value => defaults.push(value),
    preparePhoto: value => value,
    mode: mode ? () => mode : undefined,
    renderPreview,
    getSnap: snapSupport ? clip => clip.snapMark ? { ...clip.snapMark, confirmed: true }
      : tracking.expectedSnap([1, 2, 3].map(id => ({ id: String(id), offset: 2, leadIn: null, type: '' })), clip) : undefined,
    saveSnap: snapSupport ? async (clip, time) => {
      if (failSnaps) throw new Error('disk full');
      snaps.push({ clip, time });
      clip.snapMark = time === null ? null : { time };
    } : undefined,
    isExporting: () => exporting,
    onTrim: clip => trims.push({ trim: clip.trim, trimEnd: clip.trimEnd }),
    onRewind: clip => rewindChanges.push(structuredClone(clip.rewinds)),
    themes: () => [{ value: 'team-BAL', label: 'Baltimore Ravens', theme: overlay.teamTheme('BAL') }],
  });
  const clip = { file: '/film.mp4', url: 'file:///film.mp4', aStart: 10, bStart: 30, len: 5, trim: 0, fps: 30, info: { width: 1920, height: 1080 }, highlights: {} };
  element('highlight-angle').value = 'sideline';
  return {
    instance, clip, requests, writes, defaults, context, pending, cancellations, busyChanges, trims, snaps, rewindChanges,
    tick(ms) { clock.now += ms; },
    progress: value => progress(value),
    paint() {
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      callbacks.forEach(callback => callback());
    },
    el: id => element('highlight-' + id),
    setClean: value => { clean = value; },
    setExporting: value => { exporting = value; instance.refresh(); },
    failWrites: () => { failWrites = true; },
    failSnaps: () => { failSnaps = true; },
    async settle() { await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('scrubbing presents completed paired frames, coalesces pending seeks and keeps the playhead at the latest request', async () => {
  const shown = [];
  const r = editor({ mode: 'both', snapSupport: true, renderPreview: value => {
    shown.push([value.video.currentTime, value.otherVideo.currentTime]);
    return { sideline: { x: 0, y: 0, w: 960, h: 540 } };
  } });
  r.instance.select(r.clip);
  shown.length = 0;
  const seeks = [];
  for (const id of ['video', 'other-video']) {
    const video = r.el(id);
    let current = video.currentTime;
    Object.defineProperty(video, 'currentTime', {
      get: () => current,
      set(value) { current = value; video.seeking = true; seeks.push([id, value]); },
    });
  }
  for (const value of [1, 2, 3]) {
    r.el('time').value = value;
    r.el('time').fire('input');
  }
  assert.deepEqual(seeks, [['video', 11], ['other-video', 31]], 'in-flight decoding is not restarted on every input');
  assert.equal(Number(r.el('time').value), 3);
  r.el('video').seeking = false;
  r.el('video').fire('seeked');
  assert.equal(shown.length, 0, 'paired previews wait for both matching frames');
  r.el('other-video').seeking = false;
  r.el('other-video').fire('seeked');
  assert.deepEqual(shown, [[11, 31]], 'a completed frame is shown while the drag continues');
  assert.equal(Number(r.el('time').value), 3, 'completed older frames never pull the thumb backward');
  assert.equal(r.instance.ready(), false);
  await r.el('mark-play-snap').fire('click');
  assert.equal(r.snaps.length, 0, 'a pending requested frame cannot save the older displayed frame as the snap');
  r.paint();
  assert.deepEqual(seeks.slice(2), [['video', 13], ['other-video', 33]], 'only the latest request is decoded next');
  for (const id of ['video', 'other-video']) {
    r.el(id).seeking = false;
    r.el(id).fire('seeked');
  }
  assert.deepEqual(shown.at(-1), [13, 33]);
  assert.equal(r.instance.ready(), true);
  assert.equal(Number(r.el('time').value), 3);
});

test('preview initializes its playhead before metadata and discards queued seeks when changing clips', () => {
  const r = editor();
  r.clip.trim = 1;
  r.el('video').readyState = 0;
  r.el('other-video').readyState = 0;
  r.instance.select(r.clip);
  assert.equal(Number(r.el('time').value), 1);
  assert.equal(r.el('time-label').textContent, '1.00 / 5.00s');
  r.el('time').value = 2;
  r.el('time').fire('input');
  assert.equal(Number(r.el('time').value), 2);
  r.el('video').readyState = r.el('other-video').readyState = 2;
  r.el('video').fire('loadedmetadata');
  assert.equal(r.el('video').currentTime, 12);
  r.el('video').seeking = true;
  r.el('time').value = 4;
  r.el('time').fire('input');
  r.el('video').seeking = false;
  r.el('video').fire('seeked');
  const next = { ...r.clip, aStart: 50, bStart: 70, trim: 0.5 };
  r.instance.select(next);
  r.paint();
  assert.equal(r.el('video').currentTime, 50.5);
  assert.equal(r.el('other-video').currentTime, 70.5);
  assert.equal(Number(r.el('time').value), 0.5);
});

test('starting playback applies the latest queued scrub position rather than replaying an older seek', async () => {
  const r = editor({ mode: 'both' });
  r.instance.select(r.clip);
  r.el('video').seeking = r.el('other-video').seeking = true;
  r.el('time').value = 3;
  r.el('time').fire('input');
  await r.el('play').fire('click');
  assert.equal(r.el('video').currentTime, 13);
  assert.equal(r.el('other-video').currentTime, 33);
  assert.equal(r.el('video').paused, false);
  assert.equal(r.el('other-video').paused, false);
  r.el('play').fire('click');
  assert.equal(r.el('video').paused, true);
  assert.equal(r.el('other-video').paused, true);
});

test('play-level snap markers work without highlights, convert both cameras and keep confirmed cutoffs consistent', async () => {
  const r = editor({ snapSupport: true, mode: 'both' });
  r.instance.select(r.clip);
  assert.equal(r.el('snap-marker').style['--snap-position'], 0.4);
  assert.match(r.el('play-snap-status').textContent, /Expected snap/);
  assert.equal(r.el('clear-play-snap').disabled, true);
  r.el('angle').value = 'endzone';
  r.el('angle').fire('change');
  r.el('video').currentTime = 32.5;
  await r.el('mark-play-snap').fire('click');
  assert.equal(r.snaps[0].time, 2.5, 'stored timing is camera-independent, relative to the original clip');
  assert.deepEqual(r.clip.highlights, {}, 'marking a snap does not enable a player highlight');
  assert.equal(r.requests.length, 0, 'local snap marking does not start tracking or decode extra frames');
  assert.match(r.el('play-snap-status').textContent, /confirmed/);
  r.el('go-play-snap').fire('click');
  assert.equal(r.el('video').currentTime, 32.5);
  assert.equal(r.el('other-video').currentTime, 12.5);
  r.el('enabled').checked = true;
  r.el('enabled').fire('change');
  assert.equal(r.clip.highlights.endzone.snap, 32.5, 'new highlights inherit only confirmed snap cutoffs');
  r.clip.highlights.sideline = { ...r.clip.highlights.endzone, snap: 12.5 };
  r.el('video').currentTime = 33;
  await r.el('mark-play-snap').fire('click');
  assert.equal(r.clip.highlights.sideline.snap, 13);
  assert.equal(r.clip.highlights.endzone.snap, 33);
  await r.el('clear-play-snap').fire('click');
  assert.equal(r.clip.highlights.sideline.snap, null);
  assert.equal(r.clip.highlights.endzone.snap, null);
  assert.match(r.el('play-snap-status').textContent, /Expected snap/);
});

test('snap marking rejects unloaded frames, surfaces persistence failures and is frozen during export', async () => {
  const r = editor({ snapSupport: true });
  r.instance.select(r.clip);
  r.el('video').seeking = true;
  await r.el('mark-play-snap').fire('click');
  assert.equal(r.snaps.length, 0);
  assert.match(r.el('status').textContent, /finish loading/);
  r.el('video').seeking = false;
  r.failSnaps();
  await r.el('mark-play-snap').fire('click');
  assert.match(r.el('status').textContent, /disk full/);
  assert.equal(r.clip.snapMark, undefined);
  r.setExporting(true);
  assert.equal(r.el('mark-play-snap').disabled, true);
  await r.el('mark-play-snap').fire('click');
  assert.equal(r.snaps.length, 0);
});

test('timeline handles trim both cameras, seek boundary frames, clamp crossings, and stay usable for clean clips', () => {
  const r = editor({ mode: 'both' });
  r.instance.select(r.clip);
  r.setClean(true);
  r.el('trim-start').value = 1.01;
  r.el('trim-start').fire('input');
  assert.equal(r.clip.trim, 1, 'handle snaps to a frame');
  assert.equal(r.el('video').currentTime, 11);
  assert.equal(r.el('other-video').currentTime, 31);
  assert.equal(r.clip.trimEdited, true);
  r.el('trim-end').value = 4;
  r.el('trim-end').fire('input');
  assert.equal(r.clip.trimEnd, 1);
  assert.ok(Math.abs(r.el('video').currentTime - 13.999) < 1e-9, 'end previews just before the exclusive boundary, even when source cuts are not frame aligned');
  assert.ok(Math.abs(r.el('other-video').currentTime - 33.999) < 1e-9);
  assert.equal(r.el('time').style['--trim-start'], 'calc(7px + (100% - 14px) * 0.2)');
  assert.equal(r.el('time').style['--trim-end'], 'calc(7px + (100% - 14px) * 0.8)');
  assert.match(r.el('trim-end')['aria-valuetext'], /exclusive end/);
  assert.equal(r.el('trim-start').step, 1 / 30);
  assert.equal(r.trims.length, 2);
  r.el('trim-start').value = 5;
  r.el('trim-start').fire('input');
  assert.ok(Math.abs(r.clip.len - r.clip.trim - r.clip.trimEnd - 1 / 30) < 1e-9);
  r.el('trim-end').value = 0;
  r.el('trim-end').fire('input');
  assert.ok(r.clip.len - r.clip.trim - r.clip.trimEnd > 0, 'handles cannot cross');
  r.el('trim-start').value = 0;
  r.el('trim-start').fire('input');
  r.el('trim-end').value = 5;
  r.el('trim-end').fire('input');
  assert.equal(r.clip.trim, 0);
  assert.equal(r.clip.trimEnd, 0, 'full original extent can be restored');
  r.setExporting(true);
  assert.equal(r.el('trim-start').disabled, true);
  r.el('trim-start').value = 2;
  r.el('trim-start').fire('input');
  assert.equal(r.clip.trim, 0, 'export freezes trim controls');
  assert.equal(r.requests.length, 0, 'trimming never runs player tracking');
});

test('one-frame handle moves synchronize both cameras and survive metadata loading', () => {
  const r = editor({ mode: 'both' });
  r.instance.select(r.clip);
  r.el('trim-end').value = 4;
  r.el('trim-end').fire('input');
  r.el('trim-end').value = 4 - 1 / 30;
  r.el('trim-end').fire('input');
  assert.ok(Math.abs(r.el('other-video').currentTime - r.el('video').currentTime - 20) < 1e-9,
    'a move smaller than playback sync tolerance still synchronizes the preview exactly');
  const target = r.el('video').currentTime;
  r.el('video').fire('loadedmetadata');
  assert.equal(r.el('video').currentTime, target, 'metadata does not reset an end-handle preview to the start');
});

test('trim handles preview the selected end-zone angle and synchronize sideline on sub-frame clips', () => {
  const r = editor({ mode: 'endzone' });
  r.clip.len = 0.02;
  r.instance.select(r.clip);
  r.el('trim-start').value = 0.02;
  r.el('trim-start').fire('input');
  r.el('trim-end').value = 0;
  r.el('trim-end').fire('input');
  assert.equal(r.clip.trim, 0);
  assert.equal(r.clip.trimEnd, 0);
  assert.ok(Math.abs(r.el('video').currentTime - 30.019) < 1e-9);
  assert.ok(Math.abs(r.el('other-video').currentTime - 10.019) < 1e-9);
});

test('original-extent timeline preserves source frames through both trims and camera changes', async () => {
  const previews = [];
  const r = editor({ mode: 'both', renderPreview: value => {
    previews.push(value.time);
    value.canvas.width = 960;
    value.canvas.height = 1080;
    return { sideline: { x: 0, y: 0, w: 960, h: 540 }, endzone: { x: 0, y: 540, w: 960, h: 540 } };
  } });
  r.clip.trim = 1;
  r.clip.trimEnd = 1.5;
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  assert.equal(r.el('time').max, 5);
  assert.equal(r.el('video').currentTime, 11);
  assert.equal(r.el('other-video').currentTime, 31);
  assert.equal(r.el('time').style['--trim-start'], 'calc(7px + (100% - 14px) * 0.2)');
  assert.equal(r.el('time').style['--trim-end'], 'calc(7px + (100% - 14px) * 0.7)');
  r.el('time').value = 0.5;
  r.el('time').fire('input');
  r.el('video').fire('seeked');
  assert.equal(previews.at(-1), -0.5, 'play overlay receives signed retained-relative time');
  assert.match(r.el('preview-state').textContent, /Removed frame/);
  r.el('tool').value = 'player';
  await r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  r.el('set-snap').fire('click');
  assert.deepEqual(r.clip.highlights, {}, 'removed frames cannot save positions or snap annotations');
  r.el('forward').fire('click');
  assert.ok(Math.abs(r.instance.relativeTime() - (0.5 + 1 / 30)) < 1e-9);
  r.el('back').fire('click');
  assert.equal(r.instance.relativeTime(), 0.5);
  r.clip.trim = 0.75;
  r.instance.select(r.clip, true);
  assert.equal(r.el('video').currentTime, 10.5, 'trim changes do not move the original timeline cursor');
  await r.el('play').fire('click');
  assert.equal(r.el('video').currentTime, 10.75, 'play starts at the retained boundary, not a removed frame');
  r.el('video').currentTime = 13.6;
  r.el('video').fire('timeupdate');
  assert.equal(r.el('video').paused, true);
  assert.ok(r.el('video').currentTime < 13.5);
  r.el('time').value = 2;
  r.el('time').fire('input');
  r.el('angle').value = 'endzone';
  r.el('angle').fire('change');
  assert.equal(r.el('video').currentTime, 32);
  assert.equal(r.el('other-video').currentTime, 12);
  r.el('video').fire('seeked');
  await r.el('canvas').fire('click', { clientX: 480, clientY: 405 });
  assert.equal(r.requests[0].start, 32);
  assert.equal(r.requests[0].len, 1.5, 'tracking ends at the retained end');
  r.el('set-snap').fire('click');
  assert.equal(r.clip.highlights.endzone.snap, 32);
  assert.equal(r.el('snap').value, '1.250', 'snap input remains retained-relative');
  assert.equal(r.el('snap').max, 2.75);
  r.el('time').value = 4;
  r.el('time').fire('input');
  r.el('video').fire('seeked');
  assert.match(r.el('preview-state').textContent, /Removed frame/);
});

test('only clicking a player starts tracking; opening clips, changing identity/options and marking offense do not', async () => {
  const r = editor();
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  assert.equal(r.requests.length, 0);
  assert.deepEqual(r.clip.highlights, {});
  assert.equal(Number(r.el('radius').value), 3.5);
  r.el('mode').value = 'presnap';
  r.el('mode').fire('change');
  r.el('player').fire('change');
  r.el('tool').value = 'offense';
  for (const x of [300, 400, 500]) r.el('canvas').fire('click', { clientX: x, clientY: 250 });
  assert.equal(r.requests.length, 0);
  r.el('tool').value = 'player';
  await r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].file, '/film.mp4');
  assert.equal(r.requests[0].start, 10);
  assert.equal(r.requests[0].len, 5);
  assert.equal(r.requests[0].seeds.length, 4);
  assert.equal(r.clip.highlights.sideline.snap, null, 'suggested snap is not automatically accepted');
  r.el('accept-snap').fire('click');
  assert.equal(r.clip.highlights.sideline.snap, 10.1);
  await r.settle();
  assert.ok(r.writes.length >= 3);
  assert.match(r.el('coverage').textContent, /3 saved positions/);
  assert.match(r.el('coverage').textContent, /last 0.20s of 5.00s/);
});

test('corrections replace future points, retain earlier work, and do not affect the other angle', async () => {
  const r = editor();
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  await r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  const first = r.clip.highlights.sideline.points[0];
  r.el('video').currentTime = 10.15;
  const correction = r.el('canvas').fire('click', { clientX: 600, clientY: 300 });
  assert.equal(r.clip.highlights.sideline.points.length, 3);
  assert.equal(r.clip.highlights.sideline.points[0], first);
  assert.equal(r.clip.highlights.sideline.points.at(-1).t, 10.15);
  assert.equal(r.clip.highlights.sideline.points.at(-1).x, 0.625);
  assert.equal(r.requests.length, 1);
  await correction;
  r.el('angle').value = 'endzone';
  r.el('angle').fire('change');
  assert.equal(r.clip.highlights.endzone, undefined);
  r.el('canvas').fire('click', { clientX: 200, clientY: 200 });
  assert.equal(r.clip.highlights.endzone.points[0].t, 30.15, 'camera changes preserve the relative preview time');
  assert.equal(r.clip.highlights.sideline.points[2].t, 10.15);
  r.el('clear-track').fire('click');
  await r.settle();
  assert.equal(r.clip.highlights.endzone, undefined);
  assert.ok(r.clip.highlights.sideline);
});

test('moving away from a frame clears offensive seeds rather than analyzing mismatched targets', async () => {
  const r = editor();
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  await r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  r.el('tool').value = 'offense';
  r.el('canvas').fire('click', { clientX: 300, clientY: 250 });
  r.el('time').value = 0.05;
  r.el('time').fire('input');
  r.el('time').value = 0.2;
  r.el('time').fire('input');
  assert.match(r.el('offense-count').textContent, /^0 offensive/);
  assert.equal(r.requests.length, 1);
});

test('failed saves remain explicit and block export; clean mode does not place annotations', async () => {
  const r = editor();
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  r.setClean(true);
  r.instance.refresh();
  await r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  assert.deepEqual(r.clip.highlights, {});
  assert.equal(r.el('controls').disabled, true);
  r.setClean(false);
  r.failWrites();
  await r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  await r.settle();
  assert.match(r.el('status').textContent, /could not be saved: disk full/);
  await assert.rejects(r.instance.export([r.clip], 'sideline', {}, false), /Save clip annotations before exporting: disk full/);
});

test('an unfinished pre-snap highlight cannot be exported as a completed annotation', async () => {
  const r = editor();
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  await r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  r.clip.highlights.sideline.mode = 'presnap';
  await assert.rejects(r.instance.export([r.clip], 'sideline', {}, false), /Set or confirm the snap/);
});

test('saving display defaults does not enable a highlight, copy an identity, or run analysis', async () => {
  const r = editor();
  r.instance.select(r.clip);
  await r.el('defaults').fire('click');
  assert.deepEqual(r.clip.highlights, {});
  assert.equal(r.writes.length, 0);
  assert.equal(r.requests.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r.defaults[0])), tracking.DEFAULTS);
});

test('player themes and opacity are independent, persist with defaults, and can return to matching play information', async () => {
  const r = editor();
  r.instance.select(r.clip);
  assert.equal(r.el('theme').value, 'match');
  assert.equal(r.el('opacity-match').checked, true);
  r.el('theme').value = 'team-BAL';
  r.el('theme').fire('change');
  assert.deepEqual(JSON.parse(JSON.stringify(r.clip.highlights.sideline.theme)), overlay.teamTheme('BAL'));
  r.el('opacity').value = 0;
  r.el('opacity').fire('input');
  r.el('opacity').fire('change');
  assert.equal(r.clip.highlights.sideline.opacity, 0);
  assert.equal(r.el('opacity-value').textContent, '0%');
  await r.el('defaults').fire('click');
  assert.equal(r.defaults[0].opacity, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r.defaults[0].theme)), overlay.teamTheme('BAL'));
  assert.equal(r.requests.length, 0);
  r.el('theme').value = 'match';
  r.el('theme').fire('change');
  r.el('opacity-match').checked = true;
  r.el('opacity-match').fire('change');
  await r.settle();
  assert.equal(r.writes.at(-1).value.sideline.theme, null);
  assert.equal(r.writes.at(-1).value.sideline.opacity, null);
});

test('portrait placement maps to the selected camera viewport, rejects padding and other cameras, and syncs seeking', async () => {
  const r = editor({ mode: 'both', renderPreview: ({ canvas }) => {
    canvas.width = 1080; canvas.height = 1920;
    return {
      sideline: { x: 0, y: 352, w: 1080, h: 608 },
      endzone: { x: 0, y: 960, w: 1080, h: 608 },
    };
  } });
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  r.el('tool').value = 'overlay';
  await r.el('canvas').fire('click', { clientX: 480, clientY: 184.5 });
  assert.equal(r.requests.length, 0, 'moving the play card never places a player');
  r.el('tool').value = 'player';
  for (const clientY of [40, 350]) await r.el('canvas').fire('click', { clientX: 480, clientY });
  assert.equal(r.requests.length, 0, 'output padding and the other camera are not valid player placements');
  await r.el('canvas').fire('click', { clientX: 480, clientY: 184.5 });
  assert.equal(r.requests[0].seeds[0].x, 0.5);
  assert.equal(r.requests[0].seeds[0].y, 0.5);
  r.el('time').value = 1;
  r.el('time').fire('input');
  assert.equal(r.el('video').currentTime, 11);
  assert.equal(r.el('other-video').currentTime, 31);
  r.el('angle').value = 'endzone';
  r.el('angle').fire('change');
  assert.equal(r.el('video').currentTime, 31);
  assert.equal(r.el('other-video').currentTime, 11);
});

test('unloaded or seeking previews cannot receive player placements', async () => {
  const r = editor();
  r.instance.select(null);
  assert.equal(r.el('controls').disabled, true);
  assert.equal(r.instance.ready(), false);
  r.instance.select(r.clip);
  r.el('video').seeking = true;
  await r.el('canvas').fire('click', {clientX: 480, clientY: 270});
  assert.equal(r.requests.length, 0);
  assert.equal(r.instance.ready(), false);
  assert.match(r.el('status').textContent, /finish loading/);
  r.el('video').seeking = false;
  assert.equal(r.instance.ready(), true);
});

test('preview distinguishes a placed marker, a tracked frame, and untracked footage with a stop shortcut', async () => {
  const r = editor();
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  await r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  assert.match(r.el('status').textContent, /Tracking stopped early.*through 0.20s of 5.00s/);
  r.el('video').currentTime = 11;
  r.el('video').fire('timeupdate');
  assert.match(r.el('preview-state').textContent, /Untracked frame/);
  r.el('review-stop').fire('click');
  assert.equal(r.el('video').currentTime, 10.2);
  r.el('video').fire('seeked');
  assert.match(r.el('preview-state').textContent, /saved tracked position/);
  assert.match(r.el('status').textContent, /Earlier tracked positions are kept/);
  assert.equal(r.requests.length, 1, 'reviewing the stop must not rerun tracking');
});

function result(request, x = 0.6) {
  return { points: [0, 0.1, 0.2].map(t => ({ t: request.start + t, x, y: 0.5 })), suggestion: null, warnings: [] };
}

test('automatic tracking leaves playback, seeking and display edits usable and reports real progress', async () => {
  const r = editor({ deferred: true });
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  const task = r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  await r.settle();
  assert.equal(r.instance.busy(), true);
  assert.equal(r.el('controls').disabled, false);
  assert.equal(r.el('progress-panel').hidden, false);
  assert.equal(r.el('progress').value, 0);
  assert.match(r.el('coverage').textContent, /running in the background/);
  r.progress(0.45);
  assert.equal(r.el('progress').value, 0.45);
  assert.match(r.el('progress-label').textContent, /45%/);
  r.el('time').value = 1;
  r.el('time').fire('input');
  assert.equal(r.el('video').currentTime, 11);
  r.el('play').fire('click');
  await r.settle();
  assert.equal(r.el('video').paused, false);
  r.el('name').value = 'Edited while tracking';
  r.el('name').fire('change');
  await assert.rejects(r.instance.export([r.clip], 'sideline', {}, false), /Finish or cancel background/);
  r.pending[0].resolve(result(r.requests[0]));
  await task;
  assert.equal(r.clip.highlights.sideline.name, 'Edited while tracking');
  assert.equal(r.clip.highlights.sideline.points.length, 3);
  assert.equal(r.instance.busy(), false);
  assert.equal(r.el('progress-panel').hidden, true);
  assert.equal(r.el('video').currentTime, 11, 'finishing must not jump the preview back');
  assert.equal(r.el('video').paused, false, 'finishing must not interrupt playback');
});

test('rapid corrections cancel old work, coalesce queued clicks and never apply a stale result', async () => {
  const r = editor({ deferred: true });
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  r.el('canvas').fire('click', { clientX: 100, clientY: 270 });
  await r.settle();
  r.el('canvas').fire('click', { clientX: 300, clientY: 270 });
  const latest = r.el('canvas').fire('click', { clientX: 700, clientY: 270 });
  assert.equal(r.requests.length, 1, 'wait for the old worker to settle before starting another');
  r.pending[0].resolve(result(r.requests[0], 0.1));
  await r.settle();
  assert.equal(r.requests.length, 2, 'skip the superseded queued click');
  assert.equal(r.requests[1].seeds[0].x, 700 / 960);
  assert.notEqual(r.clip.highlights.sideline.points[0].x, 0.1);
  assert.equal(r.instance.busy(), true);
  r.pending[1].resolve(result(r.requests[1], 0.8));
  await latest;
  assert.equal(r.clip.highlights.sideline.points[0].x, 0.8);
  assert.ok(r.cancellations.length >= 1);
});

test('switching clips/angles and closing the editor does not lose background results or write them to another clip', async () => {
  const r = editor({ deferred: true });
  r.clip.highlightKey = 'original-clip';
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  const task = r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  await r.settle();
  const other = { ...r.clip, highlightKey: 'other-clip', highlights: {} };
  r.instance.select(other);
  r.el('angle').value = 'endzone';
  r.el('angle').fire('change');
  r.instance.select(null);
  const reopened = { ...r.clip, highlights: {} };
  r.instance.select(reopened);
  r.pending[0].resolve(result(r.requests[0]));
  await task;
  assert.equal(reopened.highlights.sideline.points.length, 3);
  assert.deepEqual(other.highlights, {});
  assert.equal(reopened.highlights.endzone, undefined);
  assert.equal(r.writes.at(-1).clip, r.clip);
  assert.equal(r.writes.at(-1).value.sideline.points.length, 3);
});

test('cancel and removal invalidate late results without replacing saved earlier positions', async () => {
  for (const action of ['cancel', 'clear-track', 'enabled']) {
    const r = editor({ deferred: true });
    r.instance.select(r.clip);
    r.el('video').fire('loadedmetadata');
    const task = r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
    await r.settle();
    if (action === 'enabled') { r.el('enabled').checked = false; r.el('enabled').fire('change'); }
    else r.el(action).fire('click');
    r.pending[0].resolve(result(r.requests[0]));
    await task;
    assert.equal(r.instance.busy(), false);
    if (action === 'cancel') assert.equal(r.clip.highlights.sideline.points.length, 1);
    else assert.equal(r.clip.highlights.sideline, undefined);
  }
});

test('background failures are explicit and a later click can retry', async () => {
  const r = editor({ deferred: true });
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  const task = r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  await r.settle();
  r.pending[0].reject(new Error('decoder failed'));
  await task;
  assert.equal(r.instance.busy(), false);
  assert.match(r.el('status').textContent, /Tracking stopped: decoder failed/);
  assert.match(r.el('coverage').textContent, /not a motion track/);
  const retry = r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  await r.settle();
  r.pending[1].resolve(result(r.requests[1]));
  await retry;
  assert.equal(r.clip.highlights.sideline.points.length, 3);
});

test('tracking finishes and saves even when the editor stays closed', async () => {
  const r = editor({ deferred: true });
  r.instance.select(r.clip);
  r.el('video').fire('loadedmetadata');
  const task = r.el('canvas').fire('click', { clientX: 480, clientY: 270 });
  await r.settle();
  r.instance.select(null);
  r.pending[0].resolve(result(r.requests[0]));
  await task;
  assert.equal(r.instance.busy(), false);
  assert.equal(r.el('editor').hidden, true);
  assert.equal(r.writes.at(-1).value.sideline.points.length, 3);
});

test('Play preview restarts at the trimmed start when the playhead was scrubbed to the end, but not mid-clip', async () => {
  const r = editor();
  r.clip.trim = 1;
  r.clip.trimEnd = 1;
  r.instance.select(r.clip);
  // Scrub parks 1 ms before the clip end; playback parks 1 ms before the end; float noise can land either side of it.
  for (const parked of [13.999, 13.9985, 13.96, 14, 14.5]) {
    r.el('video').currentTime = parked;
    r.el('video').paused = true;
    r.el('play').fire('click');
    assert.equal(r.el('video').currentTime, 11, `parked at ${parked}`);
    assert.equal(r.el('video').paused, false);
    r.el('play').fire('click');
  }
  r.el('time').value = 5;
  r.el('time').fire('input');
  r.el('play').fire('click');
  assert.equal(r.el('video').currentTime, 11, 'scrubbing the slider to its end and pressing play starts the retained play');
  r.el('play').fire('click');
  r.el('video').currentTime = 13.9;
  r.el('play').fire('click');
  assert.equal(r.el('video').currentTime, 13.9, 'two frames before the end is still mid-clip');
});

test('rewinds play backward at their speed, replay the footage once, and stop cleanly when paused', async () => {
  const r = editor();
  r.clip.rewinds = [{ id: 'a', at: 2, seconds: 1, speed: 2, color: 0 }];
  r.instance.select(r.clip);
  const video = r.el('video');
  r.el('play').fire('click');
  await r.settle();
  assert.equal(video.paused, false);
  video.currentTime = 11.9;
  r.paint();
  assert.equal(video.paused, false, 'before the rewind frame playback is ordinary');
  video.currentTime = 12.001;
  r.paint();
  assert.equal(video.paused, true);
  assert.ok(Math.abs(video.currentTime - (10 + 59 / 30)) < 1e-9, 'rewinding starts on the frame the playhead was on');
  assert.equal(r.el('play').textContent, 'Pause preview');
  assert.match(r.el('preview-state').textContent, /rewind 1 backward at 2/i);
  r.tick(250);
  r.paint();
  assert.ok(Math.abs(video.currentTime - (10 + 44 / 30)) < 1e-9, '0.25s at 2x is half a second of footage');
  assert.ok(Math.abs(Number(r.el('time').value) - 44 / 30) < 1e-9);
  r.tick(250);
  r.paint();
  assert.ok(Math.abs(video.currentTime - (10 + 29 / 30)) < 1e-9, 'the earliest rewound frame is shown');
  r.tick(100);
  r.paint();
  await r.settle();
  assert.equal(video.paused, false, 'forward play resumes after the rewind');
  assert.ok(Math.abs(video.currentTime - 11) < 1e-9, 'and continues from the frame after the earliest rewound one');
  video.currentTime = 12.2;
  r.paint();
  assert.equal(video.paused, false);
  assert.equal(video.currentTime, 12.2, 'each rewind fires once');
  r.el('play').fire('click');
  assert.equal(video.paused, true);

  video.currentTime = 10 + 59 / 30;
  r.el('play').fire('click');
  await r.settle();
  assert.equal(video.paused, true, 'playing from the exact rewind frame starts the rewind at once');
  assert.ok(Math.abs(video.currentTime - (10 + 59 / 30)) < 1e-9);
  r.tick(100);
  r.paint();
  const reversed = video.currentTime;
  assert.ok(reversed < 11.9);
  r.el('play').fire('click');
  assert.equal(video.paused, true);
  r.tick(500);
  r.paint();
  assert.equal(video.currentTime, reversed, 'pausing during a rewind stops stepping');
  assert.equal(r.el('play').textContent, 'Play preview');

  video.currentTime = 12.5;
  r.el('play').fire('click');
  await r.settle();
  r.paint();
  assert.equal(video.currentTime, 12.5, 'playing after a rewind point does not rewind');
});

test('rewinds follow the trims: ones before the start are ignored and long ones are shortened', async () => {
  const r = editor();
  r.clip.trim = 1.5;
  r.clip.rewinds = [{ id: 'a', at: 1.4, seconds: 1, speed: 2, color: 0 }, { id: 'b', at: 2.5, seconds: 2.5, speed: 1, color: 1 }];
  r.instance.select(r.clip);
  const video = r.el('video');
  video.currentTime = 11.6;
  r.el('play').fire('click');
  await r.settle();
  video.currentTime = 11.45;
  r.paint();
  assert.equal(video.paused, false, 'a rewind before the trimmed start never fires');
  video.currentTime = 12.5;
  r.paint();
  assert.equal(video.paused, true);
  r.tick(1500);
  r.paint();
  r.tick(500);
  r.paint();
  await r.settle();
  assert.ok(Math.abs(video.currentTime - (10 + 1.5 + 1 / 30)) < 1e-9, 'its rewind stops at the trimmed start, not at film that was trimmed away');
});

test('adding rewinds uses the frame on screen, defaults to 2.5s or the play start, and reports why it cannot', async () => {
  const r = editor({ mode: 'both' });
  r.clip.trim = 0.5;
  r.instance.select(r.clip);
  const video = r.el('video');
  const add = () => r.el('add-rewind').fire('click');
  video.currentTime = 10.5;
  add();
  assert.equal(r.clip.rewinds.length, 0, 'no footage before the first retained frame');
  assert.match(r.el('rewind-status').textContent, /needs footage before/i);
  video.currentTime = 10.2;
  add();
  assert.match(r.el('rewind-status').textContent, /inside the retained/i);
  video.currentTime = 11;
  add();
  const [first] = r.clip.rewinds;
  assert.deepEqual([first.at, first.seconds, first.speed, first.color], [1.033333, 0.5, 2, 0], 'the rewind is limited to the footage left after the trim');
  assert.equal(r.rewindChanges.length, 1);
  video.currentTime = 13;
  add();
  assert.equal(r.clip.rewinds[1].seconds, 2.5);
  assert.equal(r.clip.rewinds[1].color, 1);
  assert.equal(r.el('rewind-seconds').value, 2.5, 'the editor opens on the new rewind');
  video.seeking = true;
  add();
  assert.equal(r.clip.rewinds.length, 2, 'an unloaded frame cannot be rewound');
  assert.match(r.el('rewind-status').textContent, /finish loading/i);
  video.seeking = false;
  r.setExporting(true);
  add();
  assert.equal(r.clip.rewinds.length, 2, 'rewinds are frozen during export');
  r.setExporting(false);
  for (let i = 0; i < 6; i++) { video.currentTime = 12 + i / 10; add(); }
  assert.equal(r.clip.rewinds.length, 6);
  assert.deepEqual([...r.clip.rewinds].map(value => value.color), [0, 1, 2, 3, 4, 5]);
  assert.match(r.el('rewind-status').textContent, /at most 6/);
});

test('the rewind editor changes length and speed within limits and deletes only the selected rewind', async () => {
  const r = editor();
  r.instance.select(r.clip);
  const video = r.el('video');
  for (const time of [12, 13]) { video.currentTime = time; r.el('add-rewind').fire('click'); }
  const [first, second] = r.clip.rewinds;
  r.el('rewind-seconds').value = '1.25';
  r.el('rewind-seconds').fire('input');
  assert.equal(second.seconds, 1.25);
  r.el('rewind-seconds').value = '1.5';
  r.el('rewind-seconds').fire('input');
  r.el('rewind-seconds').value = '99';
  r.el('rewind-seconds').fire('change');
  assert.equal(second.seconds, 3, 'length is limited to the footage before the rewind');
  r.el('rewind-speed').value = '0.1';
  r.el('rewind-speed').fire('input');
  assert.equal(second.speed, 2, 'out-of-range speeds are not applied while typing');
  r.el('rewind-speed').fire('change');
  assert.equal(second.speed, 0.5);
  r.el('rewind-speed').value = '3';
  r.el('rewind-speed').fire('input');
  assert.equal(second.speed, 3);
  r.el('rewind-speed').value = '8';
  r.el('rewind-speed').fire('change');
  assert.equal(second.speed, 4);
  assert.equal(first.seconds, 2, 'the other rewind is untouched');
  r.setExporting(true);
  r.el('rewind-speed').value = '1';
  r.el('rewind-speed').fire('input');
  assert.equal(second.speed, 4, 'frozen during export');
  r.setExporting(false);
  const changes = r.rewindChanges.length;
  r.el('rewind-delete').fire('click');
  assert.deepEqual([...r.clip.rewinds], [first]);
  assert.equal(r.rewindChanges.length, changes + 1);
  r.el('rewind-delete').fire('click');
  assert.deepEqual([...r.clip.rewinds], [first], 'with the editor closed there is nothing to delete');
});

test('Escape closes only an open rewind editor so the export dialog stays open', async () => {
  const r = editor();
  r.instance.select(r.clip);
  r.el('video').currentTime = 12;
  r.el('add-rewind').fire('click');
  assert.equal(r.el('rewind-popover').hidden, false);
  assert.equal(r.instance.closeRewind(), true);
  assert.equal(r.el('rewind-popover').hidden, true);
  assert.equal(r.instance.closeRewind(), false, 'a second Escape is left for the dialog');
});
