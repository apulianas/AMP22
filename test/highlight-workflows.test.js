'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tracking = require('../src/shared/tracking');

function editor({ deferred = false } = {}) {
  const elements = new Map(), requests = [], writes = [], defaults = [], pending = [], cancellations = [], busyChanges = [];
  let progress;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      listeners: {}, value: '', checked: false, disabled: false, hidden: false, textContent: '',
      readyState: 2, videoWidth: 1920, videoHeight: 1080, currentTime: 10, paused: true,
      classList: { toggle() {} }, src: '',
      get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      fire(name, event = {}) { return this.listeners[name]?.(event); },
      pause() { this.paused = true; }, async play() { this.paused = false; },
      replaceChildren() {}, add() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
      getContext: () => new Proxy({}, { get: () => () => {} }),
      toDataURL: () => 'data:image/png;base64,AAAA',
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    A22: { tracking },
    document: { getElementById: element, createElement: () => element('created-canvas') },
    structuredClone, requestAnimationFrame() {},
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/player-highlights.js'), 'utf8'), context);
  let clean = false, failWrites = false;
  const instance = context.A22.createHighlightEditor({
    defaults: () => tracking.DEFAULTS, appearance: () => ({ accent: '#aabbcc', background: '#112233', text: '#ffffff', outline: '#000000', opacity: 0.9 }),
    isClean: () => clean, players: () => [], onBusy: value => busyChanges.push(value),
    save: async (clip, value) => { if (failWrites) throw new Error('disk full'); writes.push({ clip, value }); },
    saveDefaults: async value => defaults.push(value),
    preparePhoto: value => value,
  });
  const clip = { file: '/film.mp4', url: 'file:///film.mp4', aStart: 10, bStart: 30, len: 5, trim: 0, fps: 30, info: { width: 1920, height: 1080 }, highlights: {} };
  element('highlight-angle').value = 'sideline';
  return {
    instance, clip, requests, writes, defaults, context, pending, cancellations, busyChanges,
    progress: value => progress(value),
    el: id => element('highlight-' + id),
    setClean: value => { clean = value; },
    failWrites: () => { failWrites = true; },
    async settle() { await new Promise(resolve => setImmediate(resolve)); },
  };
}

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
  assert.equal(r.clip.highlights.endzone.points[0].t, 30);
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
