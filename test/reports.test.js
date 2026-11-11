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
const HEADSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS7sAAAAASUVORK5CYII=';

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

test('package names omit redundant fronts consistently in play, player and breakdown exports', () => {
  for (const [defense, front, expected] of [
    ['3-4', '3-4-4', '3-4'], ['4-3', '4-3-4', '4-3'],
    ['Jumbo', '4-3-4', 'Jumbo'], ['32 dime', '1-4-6', '32 dime'],
    ['Nickel', '2-4-5', 'Nickel 2-4-5'], ['Dime', '1-4-6', 'Dime 1-4-6'],
    ['Goal line', '5-3-3', 'Goal line 5-3-3'], ['', '', ''],
  ]) {
    const input = report({ includeAdvanced: true, fields: ['defense', 'inferredDefense', 'personnelInferred'] });
    input.plays = [input.plays[0]];
    input.plays[0].personnel = { defense, front, inferred: true };
    input.plays[0].inferredPersonnel = { defense, front };
    input.plays[0].onField = { defense: [{ id: 'defender', position: 'ILB', name: 'Defender' }] };
    for (const csv of [reports.csv(input), reports.analysisCsv(input), reports.analysisCsv(input, 'players')]) {
      const row = parseCSV(csv).rows[0];
      assert.equal(row['Defensive package'], expected);
      assert.equal(row['Inferred defensive package'], expected);
      assert.equal(row['Personnel inferred from positions'], 'Yes');
    }
    if (expected) {
      assert.ok(reports.text(input).includes(`Defensive package: ${expected}`));
      assert.ok(reports.html(input).includes(`<dd>${expected}</dd>`));
    }
    assert.equal(input.plays[0].personnel.front, front, 'formatting must not alter source composition');
  }
});

test('exports use Analysis Lab composition labels, saved custom rules and explicit inference provenance', () => {
  const analysis = require('../src/shared/analysis');
  const roster = counts => Object.entries(counts).flatMap(([position, count]) =>
    Array.from({ length: count }, (_p, i) => ({ id: `${position}-${i}`, position })));
  for (const rule of [
    ...analysis.DEFAULT_PACKAGES,
    { name: 'Jumbo nickel', counts: { DL: 3, OLB: 1, ILB: 2, CB: 2, S: 3 } },
    { name: 'WR as corner', counts: { DL: 2, OLB: 2, ILB: 2, CB: 2, S: 2, WR: 1 } },
  ]) {
    const input = report({ includeAdvanced: true, fields: ['defense', 'inferredDefense', 'personnelInferred'] });
    input.plays = [input.plays[0]];
    input.plays[0].onField = { defense: roster(rule.counts) };
    input.plays[0].personnel = { defense: 'Nickel', front: '2-4-5' };
    for (const packages of [undefined, [{ name: 'Custom package', counts: analysis.composition(input.plays[0]) }], []]) {
      input.packages = packages;
      const expected = analysis.defensivePackage(input.plays[0], packages || analysis.DEFAULT_PACKAGES);
      for (const csv of [reports.csv(input), reports.analysisCsv(input), reports.analysisCsv(input, 'players')]) {
        const rows = parseCSV(csv).rows;
        assert.ok(rows.every(row => row['Defensive package'] === expected));
        assert.ok(rows.every(row => row['Inferred defensive package'] === (expected.endsWith('*') ? expected : '')));
        assert.ok(rows.every(row => row['Personnel inferred from positions'] === (expected.endsWith('*') ? 'Yes' : 'No')));
      }
      assert.ok(reports.text(input).includes(`Defensive package: ${expected}`));
      assert.ok(reports.html(input).includes(`<dd>${expected}</dd>`));
    }
    input.packages = undefined;
    input.plays[0].onField.defense.pop();
    assert.equal(parseCSV(reports.analysisCsv(input)).rows[0]['Defensive package'], 'Nickel 2-4-5');
    input.plays[0].onField.defense = roster(rule.counts);
    input.plays[0].onField.defense[0] = input.plays[0].onField.defense[1];
    assert.equal(parseCSV(reports.analysisCsv(input)).rows[0]['Defensive package'], 'Nickel 2-4-5');
    assert.equal(input.plays[0].personnel.defense, 'Nickel', 'exports must not mutate imported classifications');
  }
  const invalid = report({ packages: [{ name: 'Invalid', counts: { DL: 10 } }] });
  assert.throws(() => reports.validateReport(invalid, 3), /totaling 11/);
  assert.throws(() => reports.analysisCsv(invalid), /totaling 11/);
  const special = report();
  special.plays = [normalizePlay({ play_type: 'kickoff' }), normalizePlay({ play_type: 'no_play' })];
  for (const p of special.plays) p.onField = { defense: roster(analysis.DEFAULT_PACKAGES[0].counts) };
  assert.ok(parseCSV(reports.analysisCsv(special)).rows.every(row =>
    row['Defensive package'] === '' && row['Inferred defensive package'] === ''));
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

test('PDF headshots match primary-player IDs, repeat in video order, and safely escape names', () => {
  const input = report({ format: 'pdf' });
  input.plays[0].playerIds.receiver = '00-receiver';
  input.plays[0].playerIds.passer = '00-passer';
  input.plays[0].names.receiver = 'Receiver <"name">';
  input.plays[1].playerIds.rusher = '00-runner';
  input.headshots = { '00-receiver': HEADSHOT, '00-passer': HEADSHOT };
  input.plays.push(
    normalizePlay({ play_type: 'pass', pass: 1, complete_pass: 0, receiver_player_id: '00-receiver', receiver_player_name: 'Receiver' }),
    normalizePlay({ play_type: 'no_play', rush: 1, rusher_player_id: '00-receiver', rusher_player_name: 'Receiver' })
  );
  input.plays = [...input.plays, ...input.plays];
  reports.validateReport(input, 10);
  const html = reports.html(input);
  assert.equal((html.match(/<img class="headshot"/g) || []).length, 2, 'only the matched receiver appears in each angle block');
  assert.match(html, /Headshot of Receiver &lt;&quot;name&quot;&gt;/);
  assert.match(html, /img-src data:/);
  assert.match(html, /object-fit: contain/);
  assert.ok(html.includes(`src="${HEADSHOT}"`));
  assert.equal(reports.csv(input), reports.csv({ ...input, headshots: undefined }));
  assert.equal(reports.text(input), reports.text({ ...input, headshots: undefined }));
});

test('PDF reports reject remote, local, malformed, or oversized headshot sources', () => {
  for (const headshots of [null, [], 'invalid', { bad: 'https://example.com/photo.png' },
    { bad: 'file:///private/photo.png' }, { bad: 'data:image/svg+xml;base64,AAAA' },
    { bad: `${HEADSHOT}" onerror="bad()` }, { bad: 'data:image/png;base64,AAAA' },
    { 'bad id': HEADSHOT }, { bad: 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024) }]) {
    const input = report({ format: 'pdf', headshots });
    assert.throws(() => reports.validateReport(input, 3), /headshot image/);
    assert.throws(() => reports.html(input), /headshot image/);
  }
});

test('report preparation, cancellation and atomic sidecar saves are explicit', async () => {
  const input = report();
  assert.equal((await prepareReport(input, 3)).toString(), reports.csv(input));
  assert.equal((await prepareReport({ ...input, format: 'txt' }, 3)).toString(), reports.text(input));
  assert.equal(await prepareReport({ ...input, format: 'none' }, 3), null);
  input.plays[0].playerIds.receiver = '00-receiver';
  const pdf = await prepareReport({ ...input, format: 'pdf', headshots: { '00-receiver': HEADSHOT } }, 3, {
    pdf: async (html, options) => {
      assert.match(html, /Baltimore Ravens/);
      assert.match(html, /<img class="headshot"/);
      assert.deepEqual(options.headshots, [HEADSHOT]);
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
