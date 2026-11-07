'use strict';

const path = require('path');
const analysis = require('../shared/analysis');
const { saveReport } = require('./reports');

function exportContent(request) {
  if (!request || !['svg', 'png', 'csv'].includes(request.format)) throw new Error('Invalid analysis export format.');
  analysis.validateReport(request.report);
  if (request.format !== 'png') return Buffer.from(analysis[request.format](request.report));
  if (typeof request.dataUrl !== 'string' || request.dataUrl.length > 24 * 1024 * 1024 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(request.dataUrl)) {
    throw new Error('Invalid chart PNG.');
  }
  const image = Buffer.from(request.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (image.length < 33 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      image.subarray(12, 16).toString() !== 'IHDR' ||
      image.readUInt32BE(16) < 1 || image.readUInt32BE(20) < 1 ||
      image.readUInt32BE(16) > 4096 || image.readUInt32BE(20) > 16000) throw new Error('Invalid chart PNG dimensions.');
  return image;
}

function registerAnalysisExport({ ipcMain, dialog, app, getWindow, participationRoot }) {
  ipcMain.handle('analysis:export', async (_event, request) => {
    const content = exportContent(request);
    const extension = request.format;
    const selected = await dialog.showSaveDialog(getWindow(), {
      title: `Export Analysis Lab ${extension.toUpperCase()}`,
      defaultPath: path.join(app.getPath('downloads'), `AMP22-analysis.${extension}`),
      filters: [{ name: extension === 'csv' ? 'CSV spreadsheet' : `${extension.toUpperCase()} graphic`, extensions: [extension] }],
    });
    if (selected.canceled) return { cancelled: true };
    const destination = selected.filePath.toLowerCase().endsWith(`.${extension}`) ? selected.filePath : `${selected.filePath}.${extension}`;
    if (extension === 'csv' && participationRoot() &&
        path.resolve(path.dirname(destination)) === path.resolve(participationRoot()) && /^nflpro-/i.test(path.basename(destination))) {
      throw new Error('Choose a filename outside the nflpro- import namespace.');
    }
    await saveReport(destination, content);
    return { path: destination };
  });
}

module.exports = { exportContent, registerAnalysisExport };
