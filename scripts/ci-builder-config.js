'use strict';

module.exports = {
  ...require('../package.json').build,
  electronVersion: require('electron/package.json').version,
  electronDownload: {
    checksums: require('electron/checksums.json'),
  },
};
