'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const motion = require('../src/main/player-motion');

const width = 320, height = 180;
function frame(center, { hidden = false, hue = 0, pose = 0, neutral = false } = {}) {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    rgb[i] = 60; rgb[i + 1] = 110; rgb[i + 2] = 35;
    if (y % 50 < 2) { rgb[i] = 190; rgb[i + 1] = 200; rgb[i + 2] = 180; }
    if (!hidden && Math.abs(x - center.x) <= 5 && Math.abs(y - center.y) <= 12) {
      rgb[i] = 90 + hue; rgb[i + 1] = 45; rgb[i + 2] = 125;
      if (Math.abs(x - center.x) < 2 && (y + pose) % 8 < 3) rgb[i] = rgb[i + 1] = rgb[i + 2] = 210;
      if (neutral) rgb[i] = rgb[i + 1] = rgb[i + 2] = (x - center.x + y - center.y + 35) % 7 < 2 ? 40 : 210;
    }
  }
  return rgb;
}

test('motion tracker follows a moving, changing jersey rather than retaining the original circle position', () => {
  const origin = { x: 80, y: 80 };
  let rgb = frame(origin), previous = motion.pyramid(rgb, width, height);
  const tracker = motion.createTracker(rgb, previous, origin);
  assert.ok(tracker.weights);
  for (let i = 1; i <= 90; i++) {
    const center = { x: origin.x + i, y: origin.y + Math.round(i / 5) };
    rgb = frame(center, { hue: Math.round(i / 15), pose: i % 6 });
    const next = motion.pyramid(rgb, width, height);
    const point = motion.advanceTracker(tracker, rgb, previous, next);
    assert.ok(point, `Track should survive a small changing jersey at frame ${i}`);
    assert.ok(Math.hypot(point.x - center.x, point.y - center.y) < 4, `Follow moving torso at frame ${i}, not the original field position`);
    previous = next;
  }
  assert.ok(tracker.point.x > origin.x + 80);
});

test('motion tracker stops instead of extrapolating across a disappeared player', () => {
  const center = { x: 100, y: 80 }, rgb = frame(center);
  const previous = motion.pyramid(rgb, width, height), tracker = motion.createTracker(rgb, previous, center);
  const empty = frame(center, { hidden: true });
  assert.equal(motion.advanceTracker(tracker, empty, previous, motion.pyramid(empty, width, height)), null);
});

test('flat turf cannot initialize a distinctive player appearance or a moving feature track', () => {
  const center = { x: 100, y: 80 }, rgb = frame(center, { hidden: true });
  const previous = motion.pyramid(rgb, width, height), tracker = motion.createTracker(rgb, previous, center);
  assert.equal(tracker.weights, null);
  assert.equal(tracker.features.length, 0);
  assert.equal(motion.advanceTracker(tracker, rgb, previous, previous), null);
});

test('grayscale/white jerseys still use feature flow when hue is not distinctive', () => {
  const origin = { x: 80, y: 80 };
  let rgb = frame(origin, { neutral: true }), previous = motion.pyramid(rgb, width, height);
  const tracker = motion.createTracker(rgb, previous, origin);
  assert.equal(tracker.weights, null);
  for (let i = 1; i <= 25; i++) {
    const center = { x: origin.x + i, y: origin.y };
    rgb = frame(center, { neutral: true });
    const next = motion.pyramid(rgb, width, height), point = motion.advanceTracker(tracker, rgb, previous, next);
    assert.ok(point, `Track a white jersey without requiring a team hue at frame ${i}`);
    assert.ok(Math.hypot(point.x - center.x, point.y - center.y) < 4);
    previous = next;
  }
});
