'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function build(context) {
  const platform = context?.electronPlatformName || process.platform;
  if (!['darwin', 'mac'].includes(platform)) return;
  if (!context && Number(os.release().split('.')[0]) < 25) return;
  const arm = context ? context.arch === 3 : process.arch === 'arm64';
  const root = path.join(__dirname, '..');
  const folder = path.join(root, 'build', 'native');
  const output = path.join(folder, 'amp22-foundation-models');
  fs.mkdirSync(folder, { recursive: true });
  if (!arm) {
    if (fs.existsSync(output)) fs.unlinkSync(output);
    return;
  }
  for (const [command, args] of [
    ['xcrun', ['swiftc', '-parse-as-library', '-O', '-target', 'arm64-apple-macos26.0',
      path.join(root, 'src/native/analytics-ai.swift'), '-o', output]],
    ['codesign', ['--force', '--sign', '-', output]],
  ]) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed building the Apple analytics helper. Xcode 26+ is required.`);
  }
}

module.exports = build;
if (require.main === module) build();
