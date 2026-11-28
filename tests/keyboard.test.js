const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scrollDeltaForInput } = require('../src/services/keyboardScroll.ts');
const { MINI_APP_KEYBOARD_SOURCE } = require('../src/services/miniAppKeyboard.ts');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('scrollDeltaForInput scrolls only when the input is hidden', () => {
  const view = { y: 100, height: 400 };
  assert.strictEqual(scrollDeltaForInput({ y: 200, height: 40 }, view), 0);
  assert.strictEqual(scrollDeltaForInput({ y: 480, height: 40 }, view), 520 + 24 - 500);
  assert.ok(scrollDeltaForInput({ y: 90, height: 40 }, view) < 0);
});

test('the mini-app keyboard script is valid JavaScript and reacts to focus and resize', () => {
  assert.doesNotThrow(() => new Function(MINI_APP_KEYBOARD_SOURCE));
  assert.match(MINI_APP_KEYBOARD_SOURCE, /focusin/);
  assert.match(MINI_APP_KEYBOARD_SOURCE, /scrollIntoView/);
  assert.match(read('src/components/MiniAppRunner.tsx'), /MINI_APP_KEYBOARD_SOURCE/);
});

test('every host input is an AppTextInput and every screen or modal with one avoids the keyboard', () => {
  const files = [
    'src/screens/HomeScreen.tsx',
    'src/components/AddonSheet.tsx',
    'src/components/AddonSettings.tsx',
    'src/components/DeveloperModeModal.tsx',
    'src/components/PlayerNamesModal.tsx',
    'src/components/SpotifySettingsModal.tsx',
    'src/components/SpotifyClientIdTutorial.tsx',
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.doesNotMatch(src, /<TextInput/, `${rel} uses a raw TextInput`);
    assert.match(src, /AppTextInput/, rel);
    if (rel !== 'src/components/AddonSettings.tsx') assert.match(src, /KeyboardSafeView/, `${rel} lacks KeyboardSafeView`);
  }
  // No Modal may open without a KeyboardSafeView inside it when the file has inputs.
  for (const rel of files.filter((f) => /Modal|Sheet|Tutorial/.test(f))) {
    const src = read(rel);
    assert.ok((src.match(/<Modal\b/g) || []).length <= (src.match(/<KeyboardSafeView/g) || []).length, rel);
  }
});

test('the runner keeps the stable WebView source and hides the nav under the keyboard', () => {
  const runner = read('src/components/MiniAppRunner.tsx');
  assert.match(runner, /stableWebViewHtml\(htmlSource\.current, html\)/);
  assert.match(runner, /keyboardVisible/);
});

test('Spotify ID save shows a checkmark and closes after a short delay', () => {
  const tutorial = read('src/components/SpotifyClientIdTutorial.tsx');
  const settings = read('src/components/SpotifySettingsModal.tsx');
  assert.match(tutorial, /SAVE_SUCCESS_CLOSE_MS = 1200/);
  assert.match(tutorial, /✓/);
  assert.match(tutorial, /onDone\?\.\(\)/);
  assert.match(settings, /onSavedDone=/);
  assert.match(settings, /✓ Gespeichert/);
});
