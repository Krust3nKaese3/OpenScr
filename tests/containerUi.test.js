const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('container screens keep the approved names and iOS gates', () => {
  const home = fs.readFileSync(path.join(root, 'src/screens/HomeScreen.tsx'), 'utf8');
  const invite = fs.readFileSync(path.join(root, 'src/components/MultiplayerOverlay.tsx'), 'utf8');
  const theme = fs.readFileSync(path.join(root, 'src/theme/containerTheme.ts'), 'utf8');
  assert.match(theme, /#0B0B0F/);
  assert.match(theme, /#A3E635/);
  assert.match(theme, /mode: AppearanceMode = 'dark'/);
  assert.match(home, /Hinzufügen/);
  assert.match(home, /Scrapp hinzufügen/);
  assert.match(home, /Nur Code, dem du vertraust/);
  assert.match(home, /showsCuratedCatalog/);
  assert.match(invite, /state\.mode === 'host'\) return null/);
  assert.doesNotMatch(invite, /Mitspieler einladen/);
  assert.doesNotMatch(invite, /Scanne den Code in OpenScr/);
  const runner = fs.readFileSync(path.join(root, 'src/components/MiniAppRunner.tsx'), 'utf8');
  assert.match(runner, /Platform\.OS !== 'android' \? null : \([\s\S]*<MultiplayerOverlay/);
});
