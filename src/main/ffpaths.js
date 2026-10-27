'use strict';

function fixAsar(p) {
  return p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p;
}

function ffmpegPath() {
  if (process.env.A22_FFMPEG) return process.env.A22_FFMPEG;
  return fixAsar(require('ffmpeg-static'));
}

function ffprobePath() {
  if (process.env.A22_FFPROBE) return process.env.A22_FFPROBE;
  return fixAsar(require('ffprobe-static').path);
}

module.exports = { ffmpegPath, ffprobePath, fixAsar };
