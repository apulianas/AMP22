'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const config = require('../package.json');

const root = path.join(__dirname, '..');

test('AMP22 keeps its application identifier and original profile across the rename', () => {
  assert.equal(config.name, 'amp22');
  assert.equal(config.productName, 'AMP22');
  assert.equal(config.build.productName, 'AMP22');
  assert.equal(config.build.appId, 'com.apulianas.a22filmtool');
  const source = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  for (const override of [undefined, path.join(root, 'out', 'test-profile')]) {
    const calls = {};
    const app = {
      setName(name) { calls.name = name; },
      getPath(key) { assert.equal(key, 'appData'); return '/profiles'; },
      setPath(key, value) { calls[key] = value; },
      whenReady() { return { then() {} }; },
      on() {},
    };
    vm.runInNewContext(source, {
      require(name) {
        if (name === 'electron') return { app };
        if (['fs', 'path', 'crypto', 'url'].includes(name)) return require(name);
        return {};
      },
      __dirname: path.join(root, 'src/main'),
      process: { env: override ? { A22_USER_DATA: override } : {}, platform: process.platform },
      Map,
    });
    assert.equal(calls.name, 'AMP22');
    assert.equal(calls.userData, override || path.join('/profiles', 'A22 Film Tool'));
  }
});

test('full-field texture uses stronger five-yard lines and edge hashes throughout the logo', () => {
  const svg = fs.readFileSync(path.join(root, 'build/AMP22.icon/Assets/field-hashes.svg'), 'utf8');
  const lines = [...svg.matchAll(/<path opacity="([^"]+)" d="M-200 (-?\d+)h1424"/g)];
  assert.equal(lines.length, 6);
  for (let i = 1; i < lines.length; i++) {
    assert.equal(Number(lines[i][2]) - Number(lines[i - 1][2]), 5 * 40);
    assert.ok(Number(lines[i][1]) > Number(lines[i - 1][1]));
  }
  const hashes = [...svg.matchAll(/<path opacity="([^"]+)" d="M24 (\d+)h32M330 \d+h32M662 \d+h32M968 \d+h32"/g)];
  const yards = [...lines, ...hashes].map((match) => Number(match[2])).sort((a, b) => a - b);
  for (let i = 1; i < yards.length; i++) assert.equal(yards[i] - yards[i - 1], 40);
  assert.equal(Number(hashes[0][2]), 20);
  assert.ok(Number(hashes[hashes.length - 1][2]) > 1024);
  assert.ok(hashes.every((match) => Number(match[1]) >= 0.07));
  for (let i = 1; i < hashes.length; i++) assert.ok(Number(hashes[i][1]) >= Number(hashes[i - 1][1]));
  assert.ok(Number(lines.find((match) => match[2] === '780')[1]) > Number(hashes.find((match) => match[2] === '820')[1]));
});

test('native Composer document retains separate glass layers and platform exports', () => {
  const document = path.join(root, config.build.mac.icon);
  const composition = JSON.parse(fs.readFileSync(path.join(document, 'icon.json'), 'utf8'));
  assert.deepEqual(composition.fill['linear-gradient'], [
    'srgb:0.16,0.16,0.16,1',
    'srgb:0.015,0.015,0.015,1',
  ]);
  assert.deepEqual(composition.groups.map((group) => group.name), ['Purple 22', 'Orange AMP', 'Field texture']);
  for (const group of composition.groups) {
    const glass = group.name !== 'Field texture';
    assert.equal(group.specular, glass);
    for (const layer of group.layers) {
      assert.equal(layer.glass, glass);
      assert.match(fs.readFileSync(path.join(document, 'Assets', layer['image-name']), 'utf8'), /viewBox="0 0 1024 1024"/);
    }
  }
  const png = fs.readFileSync(path.join(root, 'src/renderer/assets/icon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  const icns = fs.readFileSync(path.join(root, config.build.dmg.icon));
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);

  const ico = fs.readFileSync(path.join(root, config.build.win.icon));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  let end = 6 + 6 * 16;
  for (const [i, size] of [16, 32, 48, 64, 128, 256].entries()) {
    const entry = 6 + i * 16;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.equal(offset, end);
    assert.equal(ico.subarray(offset + 1, offset + 4).toString(), 'PNG');
    assert.equal(ico.readUInt32BE(offset + 16), size);
    assert.equal(ico.readUInt32BE(offset + 20), size);
    end = offset + length;
  }
  assert.equal(end, ico.length);
});
