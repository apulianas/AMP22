'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const reports = require('../src/shared/reports');
const { normalizePlay } = require('../src/shared/plays');
const { parseCSV } = require('../src/shared/csv');
const { prepareReport, reportPath, saveReport } = require('../src/main/reports');
const { COLORS, TEAMS } = require('../src/shared/teams');

function report(patch = {}) {
  const plays = [
    normalizePlay({ play_id: 17, qtr: 1, time: '10:21', posteam: 'BAL', defteam: 'BUF',
      play_type: 'pass', pass: '1', complete_pass: '1', down: 2, ydstogo: 7, yrdln: 'BAL 30',
      passer_player_name: 'L.Jackson', receiver_player_name: 'Z.Flowers', yards_gained: 12,
      air_yards: 0, desc: 'A "quoted", completed pass\nwith a second line.' }),
    normalizePlay({ play_id: 23, qtr: 2, time: '09:11', posteam: 'BUF', defteam: 'BAL',
      play_type: 'run', rush: '1', down: 1, ydstogo: 10, yrdln: 'BUF 40',
      rusher_player_name: 'J.Cook', yards_gained: -3, desc: 'A rush for a loss.' }),
    normalizePlay({ play_id: 25, qtr: 2, time: '08:42', posteam: 'BAL', defteam: 'BUF',
      play_type: 'punt', desc: 'A punt.' }),
  ];
  plays[0].charting = { motion: false, blitzers: 0, qbLocation: 'Shotgun', coverage: 'Cover 3' };
  plays[0].personnel = { offense: '12', defense: 'Nickel', front: '2-4-5' };
  plays[0].key = ['BIG'];
  return { ...reports.mergeOptions(), team: 'BAL', matchup: 'BUF at BAL · 2024 · Week 4', plays, ...patch };
}

test('CSV rows exactly follow video order, quote text, and omit advanced statistics by default', () => {
  const input = report();
  const csv = reports.csv(input);
  assert.ok(csv.startsWith('\ufeff'));
  const parsed = parseCSV(csv);
  assert.deepEqual(parsed.rows.map((p) => p['Clip number']), ['1', '2', '3']);
  assert.deepEqual(parsed.rows.map((p) => p['Game play ID']), ['17', '23', '25']);
  assert.equal(parsed.rows[0].Description, input.plays[0].desc);
  assert.match(parsed.rows[0].Result, /L.Jackson.*Z.Flowers/);
  assert.ok(!csv.includes('[object Object]'));
  assert.equal(parsed.rows[1]['Yards gained'], '-3');
  assert.equal(parsed.rows[2]['Yards gained'], '');
  assert.ok(!parsed.header.includes('Air yards'));
  assert.ok(!parsed.header.includes('Motion'));
});

test('advanced exports include only chosen fields and distinguish missing, zero, and false', () => {
  const input = report({ includeAdvanced: true, fields: ['airYards', 'motion', 'blitzers', 'personnel'] });
  const { rows, header } = parseCSV(reports.csv(input));
  assert.equal(rows[0]['Air yards'], '0');
  assert.equal(rows[0].Motion, 'No');
  assert.equal(rows[0].Blitzers, '0');
  assert.equal(rows[0]['Offensive personnel'], '12');
  assert.equal(rows[1]['Air yards'], '');
  assert.equal(rows[1].Motion, '');
  assert.ok(!header.includes('Coverage'));
  assert.match(reports.text(input), /Motion: No/);
  assert.match(reports.text(input), /Air yards: Not available/);
  assert.ok(!reports.text(input).includes('Coverage:'));
  assert.match(reports.html(input), /<dd>No<\/dd>/);
  assert.match(reports.html(input), /Not available/);
  assert.ok(!reports.html(input).includes('<dt>Coverage</dt>'));
});

test('CSV prevents formula execution without changing numeric losses', () => {
  const input = report();
  for (const desc of ['=HYPERLINK("https://example.com")', '+cmd', '-cmd', '@SUM(1)', '\t=cmd', '\n =cmd']) {
    input.plays[0].desc = desc;
    assert.equal(parseCSV(reports.csv(input)).rows[0].Description, "'" + desc);
  }
  assert.equal(parseCSV(reports.csv(input)).rows[1]['Yards gained'], '-3');
});

test('PDF layout uses real team colors, escaped content, rich play cards, and video order', () => {
  const input = report({ includeAdvanced: true, fields: ['coverage', 'defense'] });
  input.matchup = '<script>alert("bad")</script>';
  input.plays[0].desc = '<img src="file:///private" onerror="bad()">';
  const html = reports.html(input);
  assert.ok(html.includes(COLORS.BAL[0]));
  assert.ok(html.includes(COLORS.BAL[1]));
  assert.ok(html.includes(COLORS.BUF[0]));
  assert.match(html, /Baltimore Ravens/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img '));
  assert.match(html, /Nickel 2-4-5/);
  assert.match(html, /Cover 3/);
  assert.match(html, /EXPORTED PLAYS/);
  assert.match(html, /break-inside: avoid/);
  assert.equal((html.match(/<article /g) || []).length, 3);
  assert.ok(html.indexOf('Q1 10:21') < html.indexOf('Q2 09:11'));
  assert.ok(html.indexOf('Q2 09:11') < html.indexOf('Q2 08:42'));
  assert.ok(Object.keys(TEAMS).every((team) => COLORS[team]?.every((color) => /^#[0-9a-f]{6}$/.test(color))));
});

test('breakdown validation requires one play per clip and known options', () => {
  assert.doesNotThrow(() => reports.validateReport(report(), 3));
  assert.throws(() => reports.validateReport(report(), 2), /every exported play/);
  assert.throws(() => reports.validateReport(report({ format: 'html' }), 3), /options/);
  assert.throws(() => reports.validateReport(report({ fields: ['secret'] }), 3), /options/);
  assert.throws(() => reports.validateReport(report({ includeAdvanced: 'yes' }), 3), /options/);
  assert.throws(() => reports.validateReport(report({ plays: [null, {}, {}] }), 3), /every exported play/);
});

test('report preparation, cancellation and atomic sidecar saves are explicit', async () => {
  const input = report();
  assert.equal((await prepareReport(input, 3)).toString(), reports.csv(input));
  assert.equal((await prepareReport({ ...input, format: 'txt' }, 3)).toString(), reports.text(input));
  assert.equal(await prepareReport({ ...input, format: 'none' }, 3), null);
  const pdf = await prepareReport({ ...input, format: 'pdf' }, 3, {
    pdf: async (html) => {
      assert.match(html, /Baltimore Ravens/);
      return Buffer.from('%PDF-test');
    },
  });
  assert.equal(pdf.toString(), '%PDF-test');
  await assert.rejects(prepareReport(input, 3, { signal: AbortSignal.abort() }), /abort/i);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amp22-reports-'));
  try {
    const destination = reportPath(path.join(dir, 'clips.mp4'), 'csv');
    assert.equal(path.basename(destination), 'clips-plays.csv');
    await saveReport(destination, Buffer.from('first'));
    await saveReport(destination, Buffer.from('replacement'));
    assert.equal(await fs.readFile(destination, 'utf8'), 'replacement');
    assert.deepEqual(await fs.readdir(dir), ['clips-plays.csv']);
    await assert.rejects(saveReport(path.join(dir, 'missing', 'report.csv'), Buffer.from('data')), /ENOENT/);
    assert.deepEqual(await fs.readdir(dir), ['clips-plays.csv']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
