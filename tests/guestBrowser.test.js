const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const {
  GUEST_SHIM_SOURCE,
  decodeWsFrames,
  encodeWifiQr,
  injectGuestDocument,
  resolveGuestPath,
  utf8Encode,
  utf8Slice,
  wsAcceptKey,
} = require('../src/services/multiplayer/guestHttp.ts');
const { openGuestServer } = require('../src/services/multiplayer/guestServer.ts');
const { setGuestContent } = require('../src/services/multiplayer/guestContent.ts');
const { configureWifiStore, loadWifiPassword, rememberWifiPassword } = require('../src/services/multiplayer/wifiMemory.ts');
const { bridgeMethod } = require('../src/bridge/allowlist.ts');
const { permissionDecision } = require('../src/bridge/permissions.ts');
const {
  hostMultiplayer,
  broadcastMultiplayer,
  resetMultiplayerForTests,
  configureMultiplayer,
  subscribeMpUi,
} = require('../src/services/multiplayer/session.ts');
const { createMemoryRoomStore } = require('../src/services/multiplayer/persist.ts');

test('WLAN-Code maskiert Sonderzeichen und bleibt leer ohne Namen', () => {
  assert.strictEqual(encodeWifiQr('', 'geheim'), '');
  assert.strictEqual(encodeWifiQr('Haus', ''), 'WIFI:T:nopass;S:Haus;;');
  assert.strictEqual(encodeWifiQr('A;B', 'p:q\\r'), 'WIFI:T:WPA;S:A\\;B;P:p\\:q\\\\r;;');
});

test('Gastpfad verlangt das Token und verbietet Ausbrüche', () => {
  const token = '0123456789abcdef';
  assert.deepStrictEqual(resolveGuestPath(`/g/${token}/`, token), { ok: true, rel: '', websocket: false });
  assert.deepStrictEqual(resolveGuestPath(`/g/${token}/ws`, token), { ok: true, rel: 'ws', websocket: true });
  assert.deepStrictEqual(resolveGuestPath(`/g/${token}/js/app.js`, token), { ok: true, rel: 'js/app.js', websocket: false });
  assert.strictEqual(resolveGuestPath('/g/0000000000000000/', token).status, 404);
  assert.strictEqual(resolveGuestPath(`/g/${token}/../secret`, token).status, 403);
  assert.strictEqual(resolveGuestPath(`/g/${token}/%2e%2e/secret`, token).status, 403);
});

test('WebSocket-Accept entspricht dem Beispiel aus RFC 6455', () => {
  assert.strictEqual(wsAcceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('Gastseite setzt die Brücke und merkt sich die Identität', () => {
  assert.match(GUEST_SHIM_SOURCE, /localStorage/);
  assert.match(GUEST_SHIM_SOURCE, /guest:\s*true/);
  assert.match(GUEST_SHIM_SOURCE, /Im Browser-Gast nicht verfügbar/);
  assert.match(GUEST_SHIM_SOURCE, /openscr-guest:/);
  const html = injectGuestDocument('<html><head></head><body>Spiel</body></html>', '0123456789abcdef', 'wolf', 'K7QP');
  assert.match(html, /openscr-guest\.js/);
  assert.match(html, /"appId":"wolf"/);
  assert.match(html, /Spiel/);
});

test('Bildschirm wachhalten ist ohne Zustimmung erlaubt', () => {
  const spec = bridgeMethod('screen.keepAwake');
  assert.strictEqual(spec.category, 'screen');
  assert.deepStrictEqual(spec.validate([]), [true]);
  assert.deepStrictEqual(spec.validate([false]), [false]);
  assert.strictEqual(permissionDecision('screen', [], []), 'allow');
});

test('WLAN-Passwort bleibt nur, wenn der Host es merken will', async () => {
  const memory = new Map();
  configureWifiStore({
    async get() { return memory.get('wifi') || null; },
    async set(value) { memory.set('wifi', value); },
  });
  await rememberWifiPassword('Haus', 'geheim', true);
  assert.strictEqual(await loadWifiPassword('Haus'), 'geheim');
  await rememberWifiPassword('Haus', 'geheim', false);
  assert.strictEqual(await loadWifiPassword('Haus'), '');
  configureWifiStore(null);
});

test('echter Socket liefert die Gastseite', async () => {
  const token = '0123456789abcdef';
  const server = await openGuestServer({
    token,
    appId: 'wolf',
    room: 'K7QP',
    listen: nodeListen,
    read: async () => ({ mime: 'text/html', body: utf8Encode('<html><head></head><body>Hi</body></html>') }),
    onLink() {},
  });
  try {
    const text = await httpGet(server.port, `/g/${token}/`);
    assert.match(text, /openscr-guest\.js/);
    assert.match(text, /Hi/);
    const missing = await httpGet(server.port, '/g/0000000000000000/');
    assert.match(missing, /^HTTP\/1\.1 404/);
  } finally {
    server.close();
  }
});

test('Browser-Gast bekommt nach Reload den letzten Spielstand, ein App-Gast nicht als Zugabe', async () => {
  await resetMultiplayerForTests();
  const store = createMemoryRoomStore();
  let acceptGuest = null;
  const events = [];
  let ui = null;
  subscribeMpUi((state) => { ui = state; });
  configureMultiplayer({
    store,
    guestPlatform: true,
    keepAlive: async () => {},
    keepAwake: async () => {},
    readBattery: async () => ({ level: 15, charging: false }),
    guestListen(onConnection, port) {
      acceptGuest = onConnection;
      return Promise.resolve({ port: port || 9091, close() {} });
    },
  });
  setGuestContent('wolf', {
    entry: 'index.html',
    async read() {
      return { mime: 'text/html', body: utf8Encode('<html><head></head><body>spiel</body></html>') };
    },
  });
  let acceptApp = null;
  const transport = {
    async localIpv4() { return '192.168.1.20'; },
    listen(onConnection) {
      acceptApp = onConnection;
      return Promise.resolve({ port: 4040, close() {} });
    },
    async connect() { throw new Error('nein'); },
  };
  try {
    const hosted = await hostMultiplayer('wolf', (event, data) => events.push({ event, data }), { name: 'Ada', maxPlayers: 4 }, transport);
    assert.match(hosted.gameUrl, /^http:\/\/192\.168\.1\.20:\d+\/g\/[0-9a-f]+\/$/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(ui.batteryWarning, /Akku niedrig \(15 %\)/);

    const token = hosted.gameUrl.split('/g/')[1].replace(/\/$/, '');
    const first = fakeConn();
    acceptGuest(first);
    first.push(utf8Encode(
      `GET /g/${token}/ws HTTP/1.1\r\nHost: phone\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    ));
    const upgrade = utf8Slice(first.sent[0]);
    assert.match(upgrade, /101 Switching Protocols/);
    assert.match(upgrade, /s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);

    first.push(maskText(JSON.stringify({
      t: 'hello', v: 1, appId: 'wolf', room: hosted.roomCode, token, name: 'Bea',
    })));
    const welcome = framesOf(first).find((frame) => frame.t === 'welcome');
    assert.ok(welcome.secret);
    assert.strictEqual(welcome.playerId.length > 0, true);

    await broadcastMultiplayer('wolf', { type: 'state', phase: 'night' });
    const live = framesOf(first).some((frame) => frame.t === 'msg' && frame.data.phase === 'night');
    assert.strictEqual(live, true);
    const saved = await store.read('wolf');
    assert.deepStrictEqual(saved.snapshot, { type: 'state', phase: 'night' });

    first.close();
    const again = fakeConn();
    acceptGuest(again);
    again.push(utf8Encode(
      `GET /g/${token}/ws HTTP/1.1\r\nHost: phone\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    ));
    again.push(maskText(JSON.stringify({
      t: 'hello',
      v: 1,
      appId: 'wolf',
      room: hosted.roomCode,
      token,
      name: 'Bea',
      playerId: welcome.playerId,
      secret: welcome.secret,
    })));
    const replay = framesOf(again);
    const back = replay.find((frame) => frame.t === 'welcome');
    assert.strictEqual(back.playerId, welcome.playerId);
    assert.ok(replay.some((frame) => frame.t === 'msg' && frame.data.phase === 'night'));

    const appGuest = makeAppLink();
    acceptApp(appGuest);
    appGuest.push(`${JSON.stringify({
      t: 'hello', v: 1, appId: 'wolf', room: hosted.roomCode, token, name: 'Cio',
    })}\n`);
    const appFrames = appGuest.sent.flatMap((chunk) => chunk.split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    assert.ok(appFrames.some((frame) => frame.t === 'welcome'));
    assert.ok(!appFrames.some((frame) => frame.t === 'msg'));
  } finally {
    await resetMultiplayerForTests();
  }
});

function nodeListen(onConnection, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      const dataListeners = [];
      const closeListeners = [];
      socket.on('data', (buf) => dataListeners.forEach((cb) => cb(new Uint8Array(buf))));
      socket.on('close', () => closeListeners.forEach((cb) => cb()));
      socket.on('error', () => closeListeners.forEach((cb) => cb()));
      onConnection({
        send(chunk) { socket.write(Buffer.from(chunk)); },
        close() { socket.destroy(); },
        onData(cb) { dataListeners.push(cb); },
        onClose(cb) { closeListeners.push(cb); },
      });
    });
    server.once('error', reject);
    server.listen(port || 0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close() { server.close(); } });
    });
  });
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: phone\r\nConnection: close\r\n\r\n`);
    });
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

function fakeConn() {
  const dataListeners = [];
  const closeListeners = [];
  return {
    sent: [],
    send(chunk) { this.sent.push(chunk); },
    close() { closeListeners.forEach((cb) => cb()); },
    onData(cb) { dataListeners.push(cb); },
    onClose(cb) { closeListeners.push(cb); },
    push(bytes) { dataListeners.forEach((cb) => cb(bytes)); },
  };
}

function framesOf(conn) {
  const frames = [];
  conn.sent.slice(1).forEach((chunk) => {
    const decoded = decodeWsFrames(chunk);
    decoded.frames.forEach((frame) => {
      if (frame.opcode !== 1) return;
      frames.push(JSON.parse(utf8Slice(frame.payload)));
    });
  });
  return frames;
}

function maskText(text) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const extended = payload.length >= 126;
  const out = Buffer.alloc((extended ? 8 : 6) + payload.length);
  out[0] = 0x81;
  if (!extended) {
    out[1] = 0x80 | payload.length;
    mask.copy(out, 2);
    for (let i = 0; i < payload.length; i++) out[6 + i] = payload[i] ^ mask[i % 4];
  } else {
    out[1] = 0xfe;
    out[2] = (payload.length >> 8) & 0xff;
    out[3] = payload.length & 0xff;
    mask.copy(out, 4);
    for (let i = 0; i < payload.length; i++) out[8 + i] = payload[i] ^ mask[i % 4];
  }
  return new Uint8Array(out);
}

function makeAppLink() {
  const data = [];
  const closes = [];
  return {
    sent: [],
    send(frame) { this.sent.push(frame); },
    close() { this.closed = true; closes.forEach((cb) => cb()); },
    onData(cb) { data.push(cb); },
    onClose(cb) { closes.push(cb); },
    push(text) { data.forEach((cb) => cb(text)); },
  };
}
