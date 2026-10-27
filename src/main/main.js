'use strict';

const { app, BrowserWindow, ipcMain, dialog, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const media = require('./media');
const { DataService } = require('./data');
const { JsonStore } = require('./store');
const settingsMod = require('../shared/settings');
const schedule = require('../shared/schedule');
const films = require('../shared/films');
const teams = require('../shared/teams');

let win = null;
let data;
let settingsStore;
let gamesStore;
let analysisDir;
const running = new Map(); // film path -> {controller, promise}

function createWindow() {
  win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#0d1117',
    title: 'A22 Film Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function getSettings() {
  return settingsMod.mergeSettings(settingsStore.get());
}

function analysisKey(file, st) {
  return crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtimeMs}`).digest('hex');
}

function readCachedAnalysis(file, st) {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(analysisDir, analysisKey(file, st) + '.json'), 'utf8'));
    return a.version === media.ANALYSIS_VERSION ? a : null;
  } catch {
    return null;
  }
}

function listVideos(root, maxDepth = 4) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < maxDepth) walk(p, depth + 1);
      else if (e.isFile() && films.VIDEO_EXT.test(e.name)) out.push(path.relative(root, p));
    }
  };
  walk(root, 0);
  return out;
}

function registerIpc() {
  ipcMain.handle('app:init', () => ({ settings: getSettings(), platform: process.platform, version: app.getVersion(), teams: teams.TEAMS }));

  ipcMain.handle('settings:save', (_e, s) => {
    settingsStore.set(settingsMod.mergeSettings(s));
    return getSettings();
  });

  ipcMain.handle('schedule:get', async (_e, { force } = {}) => {
    const { games, warning } = await data.loadSchedule({ force });
    const def = schedule.defaultSelection(games, { team: getSettings().defaultTeam });
    return { games, defaultSelection: def, warning };
  });

  ipcMain.handle('pbp:get', async (_e, { season, gameId, force }) => {
    const def = data.games ? schedule.defaultSelection(data.games.list) : null;
    return data.loadGamePlays(season, gameId, { force, current: !def || season >= def.season });
  });

  ipcMain.handle('game:get', (_e, gameId) => gamesStore.get()[gameId] || {});
  ipcMain.handle('game:save', (_e, gameId, patch) => {
    const all = gamesStore.get();
    all[gameId] = Object.assign({}, all[gameId] || {}, patch);
    gamesStore.set(all);
    return all[gameId];
  });

  ipcMain.handle('dialog:film', async (_e, { defaultPath } = {}) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose A22 film',
      defaultPath: defaultPath || getSettings().filmRoot || app.getPath('videos'),
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'mkv'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose film folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('film:suggest', (_e, game) => {
    const root = getSettings().filmRoot;
    if (!root || !fs.existsSync(root)) return { ranked: [], auto: null };
    const { ranked, auto } = films.rankCandidates(listVideos(root), game);
    const abs = (p) => path.join(root, p);
    return { ranked: ranked.slice(0, 10).map((c) => ({ ...c, path: abs(c.path) })), auto: auto ? abs(auto) : null };
  });

  ipcMain.handle('film:open', async (_e, file) => {
    const st = fs.statSync(file);
    const cached = readCachedAnalysis(file, st);
    const info = cached ? cached.info : await media.probe(file);
    return { path: file, url: pathToFileURL(file).href, size: st.size, info, analysis: cached };
  });

  ipcMain.handle('film:analyze', async (e, { file, force }) => {
    const st = fs.statSync(file);
    if (!force) {
      const cached = readCachedAnalysis(file, st);
      if (cached) return cached;
    }
    if (running.has(file)) return running.get(file).promise;
    const controller = new AbortController();
    const sender = e.sender;
    const promise = media
      .analyzeFilm(file, {
        signal: controller.signal,
        cutThreshold: getSettings().cutThreshold,
        onProgress: (p) => { if (!sender.isDestroyed()) sender.send('film:progress', { file, ...p }); },
      })
      .then((a) => {
        fs.mkdirSync(analysisDir, { recursive: true });
        fs.writeFileSync(path.join(analysisDir, analysisKey(file, st) + '.json'), JSON.stringify(a));
        return a;
      })
      .finally(() => running.delete(file));
    running.set(file, { controller, promise });
    return promise;
  });

  ipcMain.handle('film:cancel', (_e, file) => {
    const r = running.get(file);
    if (r) r.controller.abort();
    return !!r;
  });
}

// Developer hooks: isolated profile + scripted automation (used for smoke tests / screenshots).
if (process.env.A22_USER_DATA) app.setPath('userData', path.resolve(process.env.A22_USER_DATA));

app.whenReady().then(() => {
  const ud = app.getPath('userData');
  data = new DataService(path.join(ud, 'cache'), (url) => net.fetch(url));
  settingsStore = new JsonStore(path.join(ud, 'settings.json'), {});
  gamesStore = new JsonStore(path.join(ud, 'games.json'), {});
  analysisDir = path.join(ud, 'analysis');
  registerIpc();
  createWindow();
  if (process.env.A22_DEV_SCRIPT) {
    Promise.resolve()
      .then(() => require(path.resolve(process.env.A22_DEV_SCRIPT))({ app, win, analysisDir }))
      .catch((err) => { console.error(err); app.exit(1); });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const r of running.values()) r.controller.abort();
  if (process.platform !== 'darwin') app.quit();
});
