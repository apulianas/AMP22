'use strict';

/**
 * Minimal, fast RFC-4180 CSV parser.
 * @param {string} text
 * @param {{columns?: string[]}} [opts] Restrict output objects to these columns (missing -> '').
 * @returns {{header: string[], rows: object[]}}
 */
function parseCSV(text, opts = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  const n = text.length;
  let header = null;
  let idx = null;
  let row = [];
  let field = '';
  let inQ = false;
  let i = 0;

  function endRow() {
    if (!header) {
      header = row;
      if (opts.columns) idx = opts.columns.map((c) => header.indexOf(c));
    } else if (!(row.length === 1 && row[0] === '')) {
      const obj = {};
      if (idx) {
        for (let k = 0; k < idx.length; k++) obj[opts.columns[k]] = idx[k] >= 0 && idx[k] < row.length ? row[idx[k]] : '';
      } else {
        for (let k = 0; k < header.length; k++) obj[header[k]] = k < row.length ? row[k] : '';
      }
      rows.push(obj);
    }
    row = [];
  }

  while (i < n) {
    if (inQ) {
      const j = text.indexOf('"', i);
      if (j === -1) {
        field += text.slice(i);
        i = n;
        break;
      }
      field += text.slice(i, j);
      if (text.charCodeAt(j + 1) === 34) {
        field += '"';
        i = j + 2;
      } else {
        inQ = false;
        i = j + 1;
      }
      continue;
    }
    const c = text.charCodeAt(i);
    if (c === 34) {
      inQ = true;
      i++;
    } else if (c === 44) {
      row.push(field);
      field = '';
      i++;
    } else if (c === 10 || c === 13) {
      row.push(field);
      field = '';
      endRow();
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      i++;
    } else {
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === 44 || d === 10 || d === 13 || d === 34) break;
        j++;
      }
      field += text.slice(i, j);
      i = j;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    endRow();
  }
  return { header: header || [], rows };
}

module.exports = { parseCSV };
