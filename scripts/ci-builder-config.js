'use strict';

module.exports = {
  ...require('../package.json').build,
  electronVersion: require('electron/package.json').version,
  electronDist: require('node:path').join(__dirname, '../out/ci-builder/electron'),
  electronDownload: {
    checksums: require('electron/checksums.json'),
  },
};
