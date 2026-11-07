'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/shared/analysis');

const play = (id, patch = {}) => ({
  gameId: '2024_04_BUF_BAL', playId: id, playType: 'pass', posteam: 'BUF', defteam: 'BAL',
  qtr: 1, down: 3, ydstogo: 7, yards: 8, epa: 0.5, flags: {}, ...patch,
});
const roster = (counts) => Object.entries(counts).flatMap(([position, count]) =>
  Array.from({ length: count }, (_x, i) => ({ id: `${position}-${i}`, name: `${position} ${i}`, position })));

test('scored snaps exclude nullified plays, kneels, spikes, special teams and two-point attempts', () => {
  const excluded = [
    { playType: 'no_play' }, { playType: 'qb_kneel' }, { playType: 'qb_spike' }, { playType: 'punt' },
    { flags: { qb_kneel: true } }, { flags: { qb_spike: true } },
    { flags: { special_teams_play: true } }, { flags: { two_point_attempt: true } },
  ];
  for (const patch of excluded) assert.equal(A.scoredSnap(play(1, patch)), false);
  assert.equal(A.scoredSnap(play(1, { flags: { sack: true } })), true);
  assert.equal(A.scoredSnap(play(1, { playType: 'run', flags: { qb_scramble: true } })), true);
});

test('metrics use distinct field denominators, keep zero, and include sack losses', () => {
  const result = A.summarize([
    play(1, { yards: 20, epa: 0 }),
    play(2, { yards: -8, epa: -1, flags: { sack: true } }),
    play(3, { yards: null, epa: null }),
    play(4, { yards: 0, epa: 1 }),
    play(5, { posteam: 'BAL', defteam: 'BUF' }),
  ], { team: 'BAL', split: 'none' });
  const row = result.rows[0];
  assert.equal(row.n, 4);
  assert.equal(row.totalYards, 12);
  assert.equal(row.ypp, 4);
  assert.equal(row.epa, 0);
  assert.equal(row.success, 1 / 3);
  assert.equal(row.explosive, 1 / 3);
  assert.equal(row.conversion, 1 / 3);
  assert.equal(row.epaN, 3);
  assert.equal(result.knownDefense, 0);
});

test('missing metrics remain unavailable rather than becoming zero', () => {
  const row = A.summarize([play(1, { yards: null, epa: null })]).rows[0];
  for (const metric of Object.keys(A.METRICS)) assert.equal(row[metric], null);
  assert.equal(row.totalYards, null);
  assert.equal(A.format(null, 'ypp'), 'N/A');
  assert.equal(A.format(0, 'ypp'), '0.00');
});

test('deduplication uses game and play identity and preserves other games with the same play ID', () => {
  const result = A.summarize([play(1), play(1), play(1, { gameId: 'other' })]);
  assert.equal(result.n, 2);
});

test('big and standard nickel require complete unique position evidence, not just five DBs', () => {
  const big = play(1, { onField: { defense: roster(A.DEFAULT_PACKAGES[0].counts) } });
  assert.equal(A.defensivePackage(big, A.DEFAULT_PACKAGES), 'Big nickel*');
  const standard = play(2, { onField: { defense: roster(A.DEFAULT_PACKAGES[1].counts) } });
  assert.equal(A.defensivePackage(standard, A.DEFAULT_PACKAGES), 'Standard nickel*');
  big.onField.defense[0] = big.onField.defense[1];
  assert.equal(A.defensivePackage(big, A.DEFAULT_PACKAGES), 'Unknown');
  standard.onField.defense.pop();
  standard.personnel = { defense: 'Nickel', front: '2-4-5' };
  assert.equal(A.defensivePackage(standard, A.DEFAULT_PACKAGES), 'Nickel 2-4-5');
  assert.equal(A.composition(play(3, { onField: { defense: roster({ DL: 2, LB: 4, DB: 5 }) } })).CB, undefined);
});

test('custom packages validate total, unknown positions and conflicting rules', () => {
  const custom = [{ name: 'Heavy', counts: { DL: 4, ILB: 3, CB: 2, S: 2 } }];
  const p = play(1, { onField: { defense: roster(custom[0].counts) } });
  assert.equal(A.defensivePackage(p, custom), 'Heavy*');
  assert.throws(() => A.validatePackages([{ name: 'Bad', counts: { DL: 10 } }]), /totaling 11/);
  assert.throws(() => A.validatePackages([...custom, custom[0]]), /unique/);
  assert.throws(() => A.validatePackages([{ name: 'Bad', counts: { imaginary: 11 } }]), /totaling 11/);
});

test('exact lineups group by stable identities, not changing display names or player order', () => {
  const first = roster(A.DEFAULT_PACKAGES[0].counts);
  const second = first.map((p) => ({ ...p, name: p.name.toUpperCase() })).reverse();
  const result = A.summarize([
    play(1, { onField: { defense: first } }), play(2, { onField: { defense: second } }),
  ], { group: 'lineup', split: 'none' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].n, 2);
});

test('unknown charting and false stay separate; half splits preserve overtime', () => {
  const result = A.summarize([
    play(1, { charting: { motion: true } }), play(2, { charting: { motion: false }, qtr: 3 }),
    play(3, { qtr: 5 }),
  ], { group: 'half', split: 'motion' });
  assert.deepEqual(result.rows.map((r) => [r.label, r.series]), [
    ['First half', 'Motion: Yes'], ['Overtime', 'Unknown'], ['Second half', 'Motion: No'],
  ]);
});

test('conversion uses first-down or touchdown credit and separates scramble run efficiency', () => {
  const result = A.summarize([
    play(1, { playType: 'run', flags: { qb_scramble: true }, yards: 10 }),
    play(2, { yards: 2, flags: { touchdown: true } }),
    play(3, { down: 2 }),
  ], { group: 'half', split: 'type' });
  const run = result.rows.find((r) => r.series.startsWith('Run'));
  const pass = result.rows.find((r) => r.series.startsWith('Pass'));
  assert.equal(run.explosive, 1);
  assert.equal(pass.conversion, 1);
  assert.equal(pass.conversionN, 1);
});

test('SVGs support negative metrics, escape labels and disclose metric samples and exclusions', () => {
  const rows = A.summarize([play(1, { epa: -1 })], { split: 'none' }).rows;
  for (const chart of ['bars', 'heatmap', 'halves']) {
    const svg = A.svg({ title: '<Defense & "data">', subtitle: 'BUF at BAL', notes: 'Source: nflverse', rows, metric: 'epa', chart });
    assert.match(svg, /&lt;Defense &amp; &quot;data&quot;&gt;/);
    assert.match(svg, /-1.00/);
    assert.match(svg, /metric n=1/);
    assert.match(svg, /excludes no-plays/);
    assert.doesNotMatch(svg, /NaN|Infinity|<script/);
  }
});

test('summary CSV exports definitions and all rows with spreadsheet-safe text', () => {
  const report = { title: '=FORMULA', subtitle: 'Scope', notes: 'Known / eligible', metric: 'ypp', chart: 'bars',
    rows: A.summarize([play(1, { yards: -8, epa: -1 })], { split: 'none' }).rows };
  assert.match(A.csv(report), /"'=FORMULA"/);
  assert.match(A.csv(report), /Yards sample/);
  assert.match(A.csv(report), /"-8"/);
  assert.doesNotMatch(A.csv(report), /"'-8"/);
  assert.match(A.csv(report), /excludes no-plays/);
  assert.throws(() => A.svg({ ...report, rows: [{ ...report.rows[0], ypp: Infinity }] }), /Invalid/);
});
