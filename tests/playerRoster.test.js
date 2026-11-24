const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPlayerParts, playerKey, formatPlayer } = require('../src/services/playerRoster.ts');

test('a riot-style name keeps spaces and ignores case in the key', () => {
  const parts = checkPlayerParts('  Mina  Wolf  ', 'ab3');
  assert.deepEqual(parts, { name: 'Mina Wolf', tag: 'ab3' });
  assert.equal(formatPlayer(parts), 'Mina Wolf#ab3');
  assert.equal(playerKey('Mina Wolf', 'AB3'), playerKey('mina wolf', 'ab3'));
});

test('a name rejects first and last style extras and a short tag', () => {
  assert.throws(() => checkPlayerParts('A', 'ABC'), /3 bis 16/);
  assert.throws(() => checkPlayerParts('Mina!', 'ABC'), /3 bis 16/);
  assert.throws(() => checkPlayerParts('Mina', 'AB'), /Tag/);
  assert.throws(() => checkPlayerParts(' Mina ', 'A B'), /Tag/);
});
