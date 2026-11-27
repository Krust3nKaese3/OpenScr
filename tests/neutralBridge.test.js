const test = require('node:test');
const assert = require('node:assert');
const { buildClip, CLIP_HEADER, CLIP_RATE } = require('../src/services/audioClip.ts');
const { splitBytes, pushBinaryChunk, bytesToBase64 } = require('../src/services/binaryWire.ts');
const { bridgeMethod, assessBridgeCall } = (() => {
  const allow = require('../src/bridge/allowlist.ts');
  const ios = require('../src/services/iosPolicy.ts');
  return { bridgeMethod: allow.bridgeMethod, assessBridgeCall: ios.assessBridgeCall };
})();

test('zehn Sekunden mu-law sind 160012 Bytes', () => {
  const silent = new Float32Array(44100);
  const clip = buildClip(silent, 44100, 0, 10000);
  assert.strictEqual(clip.length, CLIP_HEADER + CLIP_RATE * 10);
  assert.strictEqual(clip.length, 160012);
  assert.strictEqual(String.fromCharCode(clip[0], clip[1], clip[2], clip[3]), 'MULW');
  const cut = buildClip(silent, 44100, 1000, 10000);
  assert.strictEqual(cut.length, 160012);
});

test('Binärstücke über 32 KiB werden wieder ganz', () => {
  const bytes = new Uint8Array(40 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
  const chunks = splitBytes(bytes);
  assert.ok(chunks.length > 1);
  let slot;
  let done;
  for (const chunk of chunks) {
    const step = pushBinaryChunk(slot, chunk);
    slot = step.slot;
    done = step.done;
  }
  assert.ok(done);
  assert.deepStrictEqual(done, bytes);
  const spec = bridgeMethod('multiplayer.sendBinary');
  const payload = spec.validate([{ id: 'c3', base64: bytesToBase64(bytes.slice(0, 20)), to: 'p1' }])[0];
  assert.strictEqual(payload.id, 'c3');
  assert.strictEqual(assessBridgeCall('ios', 'multiplayer.sendBinary'), assessBridgeCall('ios', 'multiplayer.send'));
  assert.strictEqual(assessBridgeCall('ios', 'net.fetch'), null);
  assert.strictEqual(bridgeMethod('net.fetch').category, 'http');
});
