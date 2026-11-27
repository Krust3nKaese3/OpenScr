const test = require('node:test');
const assert = require('node:assert');
const { parseAddonManifest, versionAtLeast, scrappMatchesTarget } = require('../src/services/addons/manifest.ts');
const { injectionForScrapp } = require('../src/services/addons/inject.ts');
const { downloadAddon } = require('../src/services/addons/download.ts');
const { addonsAvailable } = require('../src/services/iosPolicy.ts');

test('addon.json wird geprüft und die Version verglichen', () => {
  const manifest = parseAddonManifest({
    id: 'dance-tools',
    name: 'Dance',
    version: '1.2.0',
    icon: '♪',
    targetScrapp: 'owner/ImposterDanceScrapp',
    minScrappVersion: '1.0.0',
    entry: 'main.js',
  });
  assert.strictEqual(manifest.id, 'dance-tools');
  assert.strictEqual(versionAtLeast('1.2.0', '1.0.0'), true);
  assert.strictEqual(versionAtLeast('1.0', '1.0.1'), false);
  assert.throws(() => parseAddonManifest({ ...manifest, entry: '../x.js' }), /entry/);
  assert.strictEqual(addonsAvailable('ios'), false);
  assert.strictEqual(addonsAvailable('android'), true);
  assert.strictEqual(addonsAvailable('web'), true);
});

test('ein Add-on trifft die OpenScrapp und läuft nach ihrem Code', () => {
  const scrapp = { id: 'github_com_owner_app', repoUrl: 'https://github.com/owner/ImposterDanceScrapp', name: 'Imposter', version: '1.0.0' };
  assert.strictEqual(scrappMatchesTarget('owner/ImposterDanceScrapp', scrapp), true);
  assert.strictEqual(scrappMatchesTarget('other/nope', scrapp), false);
  const built = injectionForScrapp([{
    id: 'dance-tools',
    name: 'Dance',
    version: '1.0.0',
    icon: '♪',
    targetScrapp: 'owner/ImposterDanceScrapp',
    minScrappVersion: '2.0.0',
    entry: 'main.js',
    repoUrl: 'https://github.com/owner/dance-tools',
    commitSha: 'a'.repeat(40),
    enabled: true,
    files: { 'main.js': 'globalThis.marker = 1;' },
  }], scrapp);
  assert.strictEqual(built.script.includes('globalThis.marker'), false);
  assert.ok(built.errors[0].message.includes('minScrappVersion'));
  const ok = injectionForScrapp([{
    id: 'dance-tools',
    name: 'Dance',
    version: '1.0.0',
    icon: '♪',
    targetScrapp: scrapp.id,
    minScrappVersion: '1.0.0',
    entry: 'main.js',
    repoUrl: 'https://github.com/owner/dance-tools',
    commitSha: 'b'.repeat(40),
    enabled: true,
    files: { 'lib.js': 'var lib = 1;', 'main.js': 'var started = lib;' },
  }], { ...scrapp, version: '1.0.0' });
  assert.ok(ok.script.indexOf('var lib') < ok.script.indexOf('var started'));
  assert.ok(ok.script.includes('openscr:addon'));
  assert.strictEqual(ok.icons[0].icon, '♪');
});

test('download prüft addon.json über einen Ersatz für fetch', async () => {
  const sha = 'c'.repeat(40);
  const files = {
    [`https://api.github.com/repos/owner/addon/commits/main`]: { sha },
    [`https://api.github.com/repos/owner/addon/git/trees/${sha}?recursive=1`]: {
      tree: [
        { path: 'addon.json', type: 'blob' },
        { path: 'main.js', type: 'blob' },
      ],
    },
  };
  const raw = {
    [`https://raw.githubusercontent.com/owner/addon/${sha}/addon.json`]: JSON.stringify({
      id: 'dance-tools', name: 'Dance', version: '1.0.0', icon: '♪',
      targetScrapp: 'owner/app', minScrappVersion: '1.0.0', entry: 'main.js',
    }),
    [`https://raw.githubusercontent.com/owner/addon/${sha}/main.js`]: 'var ok = 1;',
  };
  const fetched = await downloadAddon('https://github.com/owner/addon', 'secret-token', async (url, init) => {
    assert.strictEqual(init.headers.Authorization, 'Bearer secret-token');
    assert.ok(url.startsWith('https://api.github.com/') || url.startsWith('https://raw.githubusercontent.com/'));
    const body = files[url] ? JSON.stringify(files[url]) : raw[url];
    assert.ok(body, url);
    return { ok: true, status: 200, text: async () => body };
  });
  assert.strictEqual(fetched.files['main.js'], 'var ok = 1;');
  assert.strictEqual(fetched.commitSha, sha);
});
