'use strict';

function parseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function nextReleaseVersion(baseVersion, tags, headTags) {
  const base = parseVersion(baseVersion);
  if (!base) throw new Error(`Invalid base release version: ${baseVersion}`);
  const versions = tags.map(parseVersion).filter(Boolean);
  const existing = headTags.map(parseVersion).filter((v) => v && compare(v, base) >= 0);
  // A rerun of an already released commit must use the same installer version and tag.
  if (existing.length) return existing.sort(compare).at(-1).join('.');
  const latest = [base, ...versions].sort(compare).at(-1);
  if (!Number.isSafeInteger(latest[2] + 1)) throw new Error('Release patch version is too large');
  return [latest[0], latest[1], latest[2] + 1].join('.');
}

if (require.main === module) {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const cwd = path.join(__dirname, '..');
  const tags = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const { version } = require('../package.json');
  console.log(nextReleaseVersion(version, tags(['tag', '--list']), tags(['tag', '--points-at', 'HEAD'])));
}

module.exports = { nextReleaseVersion };
