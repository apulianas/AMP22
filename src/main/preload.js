'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('app:init'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  getSchedule: (opts) => ipcRenderer.invoke('schedule:get', opts),
  getPlays: (opts) => ipcRenderer.invoke('pbp:get', opts),
  getGame: (gameId) => ipcRenderer.invoke('game:get', gameId),
  saveGame: (gameId, patch) => ipcRenderer.invoke('game:save', gameId, patch),
  chooseFilm: (opts) => ipcRenderer.invoke('dialog:film', opts),
  chooseFolder: () => ipcRenderer.invoke('dialog:folder'),
  suggestFilm: (game) => ipcRenderer.invoke('film:suggest', game),
  openFilm: (file) => ipcRenderer.invoke('film:open', file),
  analyzeFilm: (file, force) => ipcRenderer.invoke('film:analyze', { file, force }),
  cancelAnalysis: (file) => ipcRenderer.invoke('film:cancel', file),
  onProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('film:progress', h);
    return () => ipcRenderer.removeListener('film:progress', h);
  },
});
