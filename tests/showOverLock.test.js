const test = require('node:test');
const assert = require('node:assert');
const {
  readShowOverLockMap,
  showOverLockEnabled,
  withShowOverLock,
  shouldShowOverLock,
  overLockNoticeCopy,
  overLockLaunchUrl,
} = require('../src/services/showOverLock.ts');
const { classifyDeepLink } = require('../src/services/deepLinks.ts');

test('show over lock is off until this scrapp opts in', () => {
  assert.deepStrictEqual(readShowOverLockMap(null), {});
  assert.deepStrictEqual(readShowOverLockMap('{'), {});
  assert.deepStrictEqual(readShowOverLockMap('{"a":false,"b":1,"c":true}'), { c: true });
  const map = withShowOverLock({}, 'song', true);
  assert.strictEqual(showOverLockEnabled(map, 'song'), true);
  assert.strictEqual(showOverLockEnabled(map, 'other'), false);
  assert.deepStrictEqual(withShowOverLock(map, 'song', false), {});
});

test('lock notice names the scrapp and opens only that id', () => {
  assert.deepStrictEqual(overLockNoticeCopy('  Werwolf '), { title: 'Werwolf', action: 'Werwolf öffnen' });
  assert.strictEqual(overLockNoticeCopy('').action, 'OpenScrapp öffnen');
  const url = overLockLaunchUrl('app/1');
  assert.strictEqual(url, 'openscr://lock?id=' + encodeURIComponent('app/1'));
  assert.strictEqual(classifyDeepLink(url).type, 'lock');
  assert.strictEqual(classifyDeepLink(url).appId, 'app/1');
});

test('show over lock only while an Android scrapp is open', () => {
  assert.strictEqual(shouldShowOverLock('android', true, true), true);
  assert.strictEqual(shouldShowOverLock('android', false, true), false);
  assert.strictEqual(shouldShowOverLock('android', true, false), false);
  assert.strictEqual(shouldShowOverLock('ios', true, true), false);
});
