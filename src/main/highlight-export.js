'use strict';

const tracking = require('../shared/tracking');

function validateHighlights(highlights) {
  if (highlights === undefined) return;
  if (!highlights || Object.keys(highlights).some(key => !['sideline', 'endzone'].includes(key))) throw new Error('Invalid highlight angles.');
  for (const track of Object.values(highlights)) {
    tracking.validateTrack(track);
    if (track.mode === 'presnap' && track.points.length && track.snap === null) throw new Error('Set or confirm the snap for each pre-snap highlight.');
    const graphic = track.graphic;
    if (!graphic || ![graphic.width, graphic.height, graphic.anchorX, graphic.anchorY].every(Number.isFinite) ||
        graphic.width < 1 || graphic.height < 1 || graphic.width > 1024 || graphic.height > 1024 ||
        graphic.anchorX < 0 || graphic.anchorX > graphic.width || graphic.anchorY < 0 || graphic.anchorY > graphic.height ||
        typeof graphic.dataUrl !== 'string' || graphic.dataUrl.length > 4 * 1024 * 1024 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(graphic.dataUrl)) throw new Error('Invalid highlight image.');
    const bytes = Buffer.from(graphic.dataUrl.split(',')[1], 'base64');
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.toString('ascii', 12, 16) !== 'IHDR' ||
        bytes.readUInt32BE(16) !== graphic.width || bytes.readUInt32BE(20) !== graphic.height) throw new Error('Invalid highlight image dimensions.');
  }
}

function descriptors(clip, mode, info, centered) {
  return Object.entries(clip.highlights || {}).filter(([angle]) => mode === 'both' || mode === angle).map(([angle, track]) => {
    const start = angle === 'sideline' ? clip.aStart : clip.bStart;
    return { track, intervals: tracking.intervals(track, start, clip.len), start, geometry: tracking.geometry(mode, angle, info, centered) };
  }).filter(item => item.intervals.length);
}

function expressions({ track, intervals, start, geometry }) {
  const number = value => Number(value.toFixed(5)).toString();
  const active = interval => `gte(t,${number(interval.from)})*lt(t,${number(interval.to)})`;
  const coordinate = axis => intervals.map(interval => {
    const { a, b } = interval;
    const scale = axis === 'x' ? geometry.w : geometry.h;
    const anchor = axis === 'x' ? track.graphic.anchorX : track.graphic.anchorY;
    const origin = geometry[axis] - anchor + a[axis] * scale;
    const speed = a === b ? 0 : (b[axis] - a[axis]) * scale / (b.t - a.t);
    return `if(${active(interval)},${number(origin)}+${number(speed)}*(t-${number(a.t - start)}),0)`;
  }).join('+');
  return { x: coordinate('x'), y: coordinate('y'), enable: intervals.map(active).join('+') };
}

module.exports = { validateHighlights, descriptors, expressions };
