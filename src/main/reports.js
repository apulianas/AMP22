'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const reports = require('../shared/reports');

async function printPdf(html, { signal } = {}) {
  const { BrowserWindow } = require('electron');
  signal?.throwIfAborted();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  const abort = () => window.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await window.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    signal?.throwIfAborted();
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { top: 0.4, bottom: 0.5, left: 0.45, right: 0.45 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="font:9px Arial;color:#667085;width:100%;margin:0 40px;display:flex;justify-content:space-between"><span>AMP22 / PLAY BREAKDOWN</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
    signal?.throwIfAborted();
    return pdf;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!window.isDestroyed()) window.destroy();
  }
}

async function prepareReport(report, clipCount, { signal, pdf = printPdf } = {}) {
  reports.validateReport(report, clipCount);
  signal?.throwIfAborted();
  if (report.format === 'none') return null;
  if (report.format === 'pdf') return pdf(reports.html(report), { signal });
  return Buffer.from(report.format === 'csv' ? reports.csv(report) : reports.text(report));
}

function reportPath(videoPath, format) {
  return path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}-plays.${format}`);
}

async function saveReport(file, content) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, content, { flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    try { await fs.unlink(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

module.exports = { prepareReport, printPdf, reportPath, saveReport };
