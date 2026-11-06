'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'extensions', 'nflpro');
const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'assets', 'amp.svg'), 'utf8');
const signature = source.match(/\bd="([^"]+)"/);
if (!signature) throw new Error('The AMP logo must contain its signature path.');
const template = fs.readFileSync(path.join(folder, 'icon-template.svg'), 'utf8');
const svg = template.replace(/(<g id="signature"[^>]+)\/>/, `$1><path d="${signature[1]}"/></g>`);
if (svg === template) throw new Error('The extension icon must contain its signature placeholder.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-extension-icons-'));
app.setPath('userData', profile);
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512, height: 512, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await win.loadURL(`data:text/html;base64,${Buffer.from(
      `<html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style></head><body>${svg}</body></html>`,
    ).toString('base64')}`);
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error('Extension icon rendering produced an empty image.');
    for (const size of [16, 32, 48, 128]) {
      fs.writeFileSync(path.join(folder, `icon-${size}.png`),
        image.resize({ width: size, height: size, quality: 'best' }).toPNG());
    }
    console.log('Generated flat AMP22 extension icons at 16, 32, 48, and 128 pixels.');
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  app.quit();
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
