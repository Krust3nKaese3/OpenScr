const { getDefaultConfig } = require('expo/metro-config');

try {
  require('./scripts/guest-dev-server.cjs');
} catch (error) {
  console.warn('[openscr-guest-dev] nicht gestartet:', error && error.message ? error.message : error);
}

module.exports = getDefaultConfig(__dirname);
