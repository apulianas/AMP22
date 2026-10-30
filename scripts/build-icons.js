'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const document = path.join(root, 'build', 'AMP22.icon');
const icon = path.join(root, 'src', 'renderer', 'assets', 'icon.png');
const tool = process.env.ICON_COMPOSER_TOOL
  || '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool';

if (process.platform !== 'darwin' || !fs.existsSync(tool)) {
  throw new Error('Generating icons requires macOS and Icon Composer (Xcode 26+). Set ICON_COMPOSER_TOOL for a custom Xcode location.');
}

const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'assets', 'amp.svg'), 'utf8');
const signature = source.match(/<path\s[^>]*\bd="([^"]+)"/);
if (!signature) throw new Error('The AMP source must contain the supplied signature path.');
fs.writeFileSync(path.join(document, 'Assets', 'amp.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <path fill="#ff8a24" transform="translate(110 14) scale(.6)" d="${signature[1]}"/>
</svg>
`);

const version = JSON.parse(execFileSync(tool, ['--version'], { encoding: 'utf8' }));
const generation = Number.parseInt(version['short-bundle-version'], 10) >= 27 ? ['--design-generation', '26'] : [];
execFileSync(tool, [document, '--export-image', '--output-file', icon,
  '--platform', 'macOS', '--rendition', 'Default', '--width', '1024', '--height', '1024', '--scale', '1',
  ...generation], { stdio: 'inherit' });

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-icons-'));
try {
  const iconset = path.join(temporary, 'AMP22.iconset');
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), icon,
        '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'build', 'icon.icns')]);

  const sizes = [16, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => {
    const output = path.join(temporary, `${size}.png`);
    execFileSync('/usr/bin/sips', ['-z', String(size), String(size), icon, '--out', output], { stdio: 'ignore' });
    return fs.readFileSync(output);
  });
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  }
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, ...images]));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('Generated AMP22 Icon Composer layers, PNG, ICNS, and multi-resolution ICO.');
