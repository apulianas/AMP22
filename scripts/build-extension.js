'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'out', 'nflpro-extension');
fs.mkdirSync(destination, { recursive: true });
for (const name of fs.readdirSync(path.join(root, 'extensions', 'nflpro'))) {
  fs.copyFileSync(path.join(root, 'extensions', 'nflpro', name), path.join(destination, name));
}
fs.copyFileSync(path.join(root, 'src', 'shared', 'participation.js'), path.join(destination, 'participation.js'));
console.log('WebExtension ready in out/nflpro-extension (Chrome, Edge, temporary macOS Safari).');
