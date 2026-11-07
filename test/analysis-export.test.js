'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exportContent, registerAnalysisExport } = require('../src/main/analysis');
const analysis = require('../src/shared/analysis');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = () => ({
  title: 'Ravens defense', subtitle: '2024 Week 4', notes: 'Sources and filters', metric: 'ypp', chart: 'bars',
  rows: analysis.summarize([{ gameId: 'game', playId: 1, playType: 'run', yards: 4, epa: 0 }]).rows.map(({ plays, ...r }) => r),
});

test('analysis export rejects invalid requests and emits actual SVG/CSV', () => {
  assert.match(exportContent({ format: 'svg', report: report() }).toString(), /^<svg/);
  assert.match(exportContent({ format: 'csv', report: report() }).toString(), /Yards sample/);
  assert.throws(() => exportContent({ format: 'html', report: report() }), /Invalid/);
  assert.throws(() => exportContent({ format: 'png', report: report(), dataUrl: 'https://example.test/image.png' }), /Invalid/);
  assert.throws(() => exportContent({ format: 'png', report: report(), dataUrl: 'data:image/png;base64,AAAA' }), /Invalid/);
});

test('analysis export saves atomically, supports cancellation and protects participation inputs', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-analysis-export-'));
  try {
    let handle;
    let selection = { canceled: true };
    registerAnalysisExport({
      ipcMain: { handle: (_channel, cb) => { handle = cb; } },
      dialog: { showSaveDialog: async () => selection },
      app: { getPath: () => folder }, getWindow: () => null, participationRoot: () => folder,
    });
    const request = { format: 'svg', report: report() };
    assert.deepEqual(await handle(null, request), { cancelled: true });
    selection = { canceled: false, filePath: path.join(folder, 'graphic') };
    const saved = await handle(null, request);
    assert.equal(saved.path, selection.filePath + '.svg');
    assert.match(fs.readFileSync(saved.path, 'utf8'), /Ravens defense/);
    selection = { canceled: false, filePath: path.join(folder, 'nflpro-source.csv') };
    await assert.rejects(handle(null, { ...request, format: 'csv' }), /namespace/);
    assert.equal(fs.readdirSync(folder).length, 1);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
