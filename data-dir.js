// data-dir.js — Central data directory resolution
// All persistent storage (accounts, guilds, auction, plots, placements, serial)
// uses this module to resolve the data root.
//
// Override with MMOLITE_DATA_DIR env var for production or custom paths.
// Default: path.join(__dirname, 'data')

var path = require('path');
var fs = require('fs');

var DATA_DIR = process.env.MMOLITE_DATA_DIR || path.join(__dirname, 'data');

// Ensure the root data directory exists at startup
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

// Resolve a subdirectory under the data root (e.g., 'accounts', 'guilds')
function subdir(name) {
  var dir = path.join(DATA_DIR, name);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

module.exports = {
  DATA_DIR: DATA_DIR,
  subdir: subdir,
};
