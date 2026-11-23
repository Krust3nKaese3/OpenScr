const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function load(variant) {
  const previous = process.env.APP_VARIANT;
  if (variant == null) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  const file = path.join(__dirname, '../app.config.js');
  delete require.cache[file];
  const app = require('../app.json');
  const config = require('../app.config.js')({ config: app.expo });
  if (previous == null) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = previous;
  delete require.cache[file];
  return config;
}

test('APP_VARIANT dev and development build OpenScr Dev', () => {
  for (const variant of ['dev', 'development']) {
    const config = load(variant);
    assert.strictEqual(config.name, 'OpenScr Dev');
    assert.strictEqual(config.scheme, 'openscrdev');
    assert.strictEqual(config.android.package, 'com.openscr.app.dev');
    assert.strictEqual(config.ios.bundleIdentifier, 'com.openscr.app.dev');
  }
  const eas = require('../eas.json');
  assert.strictEqual(eas.build.development.env.APP_VARIANT, 'dev');
});

test('unset APP_VARIANT stays production OpenScr', () => {
  const config = load(null);
  assert.strictEqual(config.name, 'OpenScr');
  assert.strictEqual(config.scheme, 'openscr');
  assert.strictEqual(config.android.package, 'com.openscr.app');
  assert.strictEqual(config.ios.bundleIdentifier, 'com.openscr.app');
});
