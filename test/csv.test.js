'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCSV } = require('../src/shared/csv');

test('parses header, quoted fields, embedded commas/quotes/newlines and CRLF', () => {
  const text = 'a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"multi\nline",\n';
  const { header, rows } = parseCSV(text);
  assert.deepEqual(header, ['a', 'b', 'c']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { a: '1', b: 'x, y', c: 'he said "hi"' });
  assert.equal(rows[1].b, 'multi\nline');
  assert.equal(rows[1].c, '');
});

test('visits selected columns without retaining large source tables', () => {
  const visited = [];
  const result = parseCSV('\ufeffa,b,c\r\n1,"two,\nlines",3\r\n4,"a ""quote""",6',
    { columns: ['b', 'missing'], onRow: row => visited.push(row) });
  assert.deepEqual(result.header, ['a', 'b', 'c']);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(visited, [{ b: 'two,\nlines', missing: '' }, { b: 'a "quote"', missing: '' }]);
});
