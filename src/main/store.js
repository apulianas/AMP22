'use strict';

const fs = require('fs');
const path = require('path');

/** Tiny JSON file store with atomic writes. */
class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = defaults;
    }
  }
  get() {
    return this.data;
  }
  set(data) {
    this.data = data;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
    return this.data;
  }
}

module.exports = { JsonStore };
