'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextReleaseVersion } = require('../scripts/release-version');

test('releases increment the highest stable version, including the package baseline', () => {
  assert.equal(nextReleaseVersion('0.2.0', [], []), '0.2.1');
  assert.equal(nextReleaseVersion('0.2.0', ['v0.2.9', 'v0.2.10', 'v0.1.99'], []), '0.2.11');
  assert.equal(nextReleaseVersion('0.3.0', ['v0.2.10'], []), '0.3.1');
  assert.equal(nextReleaseVersion('0.2.0', ['v1.0.0'], []), '1.0.1');
});

test('unrelated tags and prereleases do not affect stable release numbering', () => {
  assert.equal(nextReleaseVersion('0.2.0', ['archive', 'v1.0.0-beta.1', 'v00.2.9'], []), '0.2.1');
});

test('reruns reuse a stable version already tagged at the current commit', () => {
  assert.equal(nextReleaseVersion('0.2.0', ['v0.2.1'], ['v0.2.1']), '0.2.1');
  assert.equal(nextReleaseVersion('0.2.0', ['v0.2.1', 'v0.2.2'], ['v0.2.1']), '0.2.1');
  assert.equal(nextReleaseVersion('0.2.0', ['v0.1.0'], ['v0.1.0']), '0.2.1');
});

test('invalid or overflowing release versions fail explicitly', () => {
  assert.throws(() => nextReleaseVersion('invalid', [], []), /Invalid base release version/);
  assert.throws(() => nextReleaseVersion('0.2.9007199254740991', [], []), /too large/);
});
