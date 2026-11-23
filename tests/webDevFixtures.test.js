const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../src/services/webDevFixtures.ts');

test('web spotify fixture plays, pauses and skips', async () => {
  fx.devSetPlaying();
  const started = await fx.webSpotify.getPlayerState();
  assert.equal(started.paused, false);
  assert.ok(started.track.uri);
  const paused = await fx.webSpotify.pause();
  assert.equal(paused.paused, true);
  const next = await fx.webSpotify.skipNext();
  assert.notEqual(next.track.uri, started.track.uri);
  assert.equal(next.paused, false);
});

test('web spotify fixture search returns tracks', async () => {
  fx.devSetPlaying();
  const found = await fx.webSpotify.search('gelb');
  assert.equal(found.tracks.items[0].name, 'Gelbes U-Boot');
});

test('web bluetooth fixture scan and disconnect', () => {
  fx.devBluetoothOn();
  assert.equal(fx.webBluetoothScan()[0].name, 'Dev-Lautsprecher');
  fx.devScanEmpty();
  assert.deepEqual(fx.webBluetoothScan(), []);
  fx.webBluetoothDisconnect('00:11:22:33:44:55');
  assert.deepEqual(fx.webBluetoothConnected(false), []);
  assert.equal(fx.webBluetoothConnected(true)[0].connected, false);
});

test('web spotify fixture error is one shot', async () => {
  fx.devSetPlaying();
  fx.devFailNext();
  await assert.rejects(() => fx.webSpotify.getPlayerState(), /Fehler/);
  const again = await fx.webSpotify.getPlayerState();
  assert.equal(again.connected, true);
});
