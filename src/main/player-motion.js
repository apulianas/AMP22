'use strict';

const WIDTH = 960;
const HEIGHT = 540;
const RATE = 30;

function sample(image, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  if (ix < 0 || iy < 0 || ix >= image.width - 1 || iy >= image.height - 1) return NaN;
  const i = iy * image.width + ix, data = image.data;
  return (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) +
    (data[i + image.width] * (1 - fx) + data[i + image.width + 1] * fx) * fy;
}

function pyramid(rgb, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgb[i * 3] * 77 + rgb[i * 3 + 1] * 150 + rgb[i * 3 + 2] * 29) >> 8;
  const levels = [{ data: gray, width, height }];
  for (let level = 1; level < 3; level++) {
    const previous = levels[level - 1], w = previous.width >> 1, h = previous.height >> 1;
    const data = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        sum += previous.data[(y * 2 + dy) * previous.width + x * 2 + dx] * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
      }
      data[y * w + x] = sum / 16;
    }
    levels.push({ data, width: w, height: h });
  }
  return levels;
}

function corners(image, center) {
  const candidates = [];
  for (let y = Math.max(8, Math.round(center.y - 14)); y <= Math.min(image.height - 9, Math.round(center.y + 14)); y++) {
    for (let x = Math.max(8, Math.round(center.x - 9)); x <= Math.min(image.width - 9, Math.round(center.x + 9)); x++) {
      let xx = 0, xy = 0, yy = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const i = (y + dy) * image.width + x + dx;
        const gx = (image.data[i + 1] - image.data[i - 1]) / 2;
        const gy = (image.data[i + image.width] - image.data[i - image.width]) / 2;
        xx += gx * gx; xy += gx * gy; yy += gy * gy;
      }
      const score = (xx + yy - Math.sqrt((xx - yy) ** 2 + 4 * xy * xy)) / 2;
      if (score > 100) candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const point of candidates) {
    if (selected.every(other => Math.hypot(point.x - other.x, point.y - other.y) > 3)) selected.push(point);
    if (selected.length >= 15) break;
  }
  return selected;
}

function flow(previous, next, point, initial) {
  let dx = initial.x / 4, dy = initial.y / 4;
  for (let level = 2; level >= 0; level--) {
    if (level < 2) { dx *= 2; dy *= 2; }
    const x = point.x / (1 << level), y = point.y / (1 << level), a = previous[level], b = next[level];
    if (x < 5 || y < 5 || x >= a.width - 5 || y >= a.height - 5) return null;
    let xx = 0, xy = 0, yy = 0;
    const pixels = [];
    for (let sy = -3; sy <= 3; sy++) for (let sx = -3; sx <= 3; sx++) {
      const value = sample(a, x + sx, y + sy);
      const gx = (sample(a, x + sx + 1, y + sy) - sample(a, x + sx - 1, y + sy)) / 2;
      const gy = (sample(a, x + sx, y + sy + 1) - sample(a, x + sx, y + sy - 1)) / 2;
      pixels.push({ sx, sy, value, gx, gy });
      xx += gx * gx; xy += gx * gy; yy += gy * gy;
    }
    const determinant = xx * yy - xy * xy;
    if (determinant < 1) return null;
    for (let iteration = 0; iteration < 12; iteration++) {
      if (x + dx < 4 || y + dy < 4 || x + dx >= b.width - 4 || y + dy >= b.height - 4) return null;
      let ex = 0, ey = 0;
      for (const pixel of pixels) {
        const error = pixel.value - sample(b, x + pixel.sx + dx, y + pixel.sy + dy);
        ex += pixel.gx * error; ey += pixel.gy * error;
      }
      const ux = (yy * ex - xy * ey) / determinant, uy = (xx * ey - xy * ex) / determinant;
      if (!Number.isFinite(ux + uy) || Math.abs(ux) > 4 || Math.abs(uy) > 4) return null;
      dx += ux; dy += uy;
      if (ux * ux + uy * uy < 0.0004) break;
    }
  }
  let error = 0;
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
    error += Math.abs(sample(previous[0], point.x + x, point.y + y) - sample(next[0], point.x + x + dx, point.y + y + dy));
  }
  return error / 49 <= 25 ? { x: point.x + dx, y: point.y + dy } : null;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function colorBin(rgb, i) {
  const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2], high = Math.max(r, g, b), low = Math.min(r, g, b);
  const delta = high - low;
  if (high < 25 || delta < 15) return -1;
  let hue = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  if (hue < 0) hue += 6;
  return Math.min(23, Math.floor(hue * 4)) * 4 + Math.min(3, Math.floor(delta / high * 4));
}

function colorModel(rgb, width, height, point) {
  const inside = new Float64Array(96), outside = new Float64Array(96);
  let inCount = 0, outCount = 0;
  for (let dy = -25; dy <= 25; dy++) for (let dx = -22; dx <= 22; dx++) {
    const x = Math.round(point.x + dx), y = Math.round(point.y + dy);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const bin = colorBin(rgb, (y * width + x) * 3);
    if (bin < 0) continue;
    if (Math.abs(dx) <= 5 && Math.abs(dy) <= 9) { inside[bin]++; inCount++; }
    else if (Math.abs(dx) > 12 || Math.abs(dy) > 18) { outside[bin]++; outCount++; }
  }
  if (inCount < 10 || !outCount) return null;
  const weights = new Float64Array(96);
  for (let bin = 0; bin < weights.length; bin++) {
    weights[bin] = inside[bin] >= 3 ? Math.max(0, inside[bin] / inCount - 2 * outside[bin] / outCount) : 0;
  }
  const strongest = Math.max(...weights);
  if (strongest < 0.05) return null;
  for (let bin = 0; bin < weights.length; bin++) weights[bin] /= strongest;
  const original = weights.slice();
  for (let bin = 0; bin < weights.length; bin++) {
    const hue = bin >> 2, saturation = bin % 4;
    for (let dh = -1; dh <= 1; dh++) for (let ds = -1; ds <= 1; ds++) {
      const s = saturation + ds;
      if (s < 1 || s > 3) continue;
      const index = ((hue + dh + 24) % 24) * 4 + s;
      weights[index] = Math.max(weights[index], original[bin] * (dh || ds ? 0.65 : 1));
    }
  }
  return weights;
}

function locateColor(rgb, width, height, point, weights) {
  if (!weights) return null;
  let x = point.x, y = point.y;
  const rx = 12, ry = 20;
  for (let iteration = 0; iteration < 4; iteration++) {
    let sx = 0, sy = 0, sum = 0, count = 0;
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const ix = Math.round(x + dx), iy = Math.round(y + dy);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue;
      const bin = colorBin(rgb, (iy * width + ix) * 3), color = bin < 0 ? 0 : weights[bin];
      const distance = dx * dx / (rx * rx) + dy * dy / (ry * ry);
      if (color < 0.2 || distance > 1) continue;
      const weight = color * Math.exp(-distance * 2);
      sx += ix * weight; sy += iy * weight; sum += weight; count++;
    }
    if (sum < 3 || count < 6) return null;
    const nx = sx / sum, ny = sy / sum;
    const moved = Math.hypot(nx - x, ny - y);
    x = nx; y = ny;
    if (moved < 0.2) break;
  }
  return { x, y };
}

function createTracker(rgb, levels, point) {
  const { width, height } = levels[0];
  const weights = colorModel(rgb, width, height, point);
  const color = locateColor(rgb, width, height, point, weights);
  return {
    point: { ...point }, features: corners(levels[0], point), velocity: { x: 0, y: 0 },
    weights: color ? weights : null,
    colorOffset: color ? { x: point.x - color.x, y: point.y - color.y } : { x: 0, y: 0 },
    colorMissing: 0,
  };
}

function advanceTracker(tracker, rgb, previous, next) {
  const { width, height } = next[0], old = tracker.point;
  const pairs = [];
  for (const point of tracker.features) {
    const moved = flow(previous, next, point, tracker.velocity);
    if (!moved) continue;
    const back = flow(next, previous, moved, { x: -tracker.velocity.x, y: -tracker.velocity.y });
    if (back && Math.hypot(back.x - point.x, back.y - point.y) < 1.2) {
      pairs.push({ moved, dx: moved.x - point.x, dy: moved.y - point.y });
    }
  }
  let movement = null, good = [];
  if (pairs.length >= 3) {
    const dx = median(pairs.map(p => p.dx)), dy = median(pairs.map(p => p.dy));
    good = pairs.filter(p => Math.hypot(p.dx - dx, p.dy - dy) < 2);
    if (good.length >= 3) movement = { x: median(good.map(p => p.dx)), y: median(good.map(p => p.dy)) };
  }
  const predicted = {
    x: old.x + (movement || tracker.velocity).x - tracker.colorOffset.x,
    y: old.y + (movement || tracker.velocity).y - tracker.colorOffset.y,
  };
  const color = locateColor(rgb, width, height, predicted, tracker.weights);
  let point;
  if (color) {
    point = { x: color.x + tracker.colorOffset.x, y: color.y + tracker.colorOffset.y };
    if (Math.hypot(point.x - old.x, point.y - old.y) > 22) return null;
    tracker.colorMissing = 0;
  } else {
    // Flow can bridge a brief profile/color change, not continue indefinitely through an occlusion.
    tracker.colorMissing++;
    if (!movement || tracker.weights && tracker.colorMissing > RATE / 3) return null;
    point = { x: old.x + movement.x, y: old.y + movement.y };
  }
  if (point.x < 8 || point.y < 8 || point.x >= width - 8 || point.y >= height - 8) return null;
  tracker.velocity = { x: (point.x - old.x) * 0.6 + tracker.velocity.x * 0.4, y: (point.y - old.y) * 0.6 + tracker.velocity.y * 0.4 };
  tracker.point = point;
  tracker.features = good.map(p => p.moved).filter(p => Math.abs(p.x - point.x) < 12 && Math.abs(p.y - point.y) < 18);
  for (const candidate of corners(next[0], point)) {
    if (tracker.features.length < 18 && tracker.features.every(p => Math.hypot(p.x - candidate.x, p.y - candidate.y) > 3)) tracker.features.push(candidate);
  }
  return point;
}

module.exports = { WIDTH, HEIGHT, RATE, pyramid, createTracker, advanceTracker };
