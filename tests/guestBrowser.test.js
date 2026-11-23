const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const {
  GUEST_SHIM_SOURCE,
  decodeWsFrames,
  encodeWifiQr,
  shareableGameUrl,
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
  sendMultiplayer,
  resetMultiplayerForTests,
  configureMultiplayer,
  subscribeMpUi,
} = require('../src/services/multiplayer/session.ts');
const { createMemoryRoomStore } = require('../src/services/multiplayer/persist.ts');

test('Spiel-QR bietet Kopieren und Teilen der Beitrittsadresse', () => {
  const overlay = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/components/MultiplayerOverlay.tsx'), 'utf8');
  assert.match(overlay, /Raum wird vorbereitet/);
  assert.match(overlay, /Link kopieren/);
  assert.match(overlay, /Share\.share\(\{ message: shareableGameUrl\(url\) \}\)/);
  assert.doesNotMatch(overlay, /Komm in mein Spiel/);
  assert.doesNotMatch(overlay, /Share\.share\(\{[^}]*\burl:/);
  const join = 'http://192.168.178.94:42169/g/37acde606eedc0b8/';
  assert.strictEqual(shareableGameUrl(join), join);
  assert.strictEqual(shareableGameUrl('http://192.168.178.94:42169/g/37acde606eedc0b8'), join);
  assert.match(overlay, /Clipboard\.setStringAsync\(shareableGameUrl\(url\)\)/);
  assert.strictEqual(resolveGuestPath('/g/37acde606eedc0b8', '37acde606eedc0b8').ok, true);
  assert.match(overlay, /Share\.share/);
  assert.match(overlay, /expo-clipboard/);
  assert.strictEqual(overlay.split('<GameLinkActions').length - 1, 2);
});

test('WLAN-Einladung öffnet die Systemeinstellungen statt ein Passwortfeld', () => {
  const overlay = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/components/MultiplayerOverlay.tsx'), 'utf8');
  const share = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/services/multiplayer/lanShare.ts'), 'utf8');
  assert.match(overlay, /Stellt sicher, dass ihr im selben WLAN seid/);
  assert.match(overlay, /WLAN teilen/);
  assert.doesNotMatch(overlay, /placeholder="WLAN-Passwort"/);
  assert.match(share, /android\.settings\.WIFI_SETTINGS/);
  assert.match(share, /openSettings/);
});

test('WLAN-Code maskiert Sonderzeichen und bleibt leer ohne Namen', () => {
  assert.strictEqual(encodeWifiQr('', 'geheim'), '');
  assert.strictEqual(encodeWifiQr('Haus', ''), 'WIFI:T:nopass;S:Haus;;');
  assert.strictEqual(encodeWifiQr('A;B', 'p:q\\r'), 'WIFI:T:WPA;S:A\\;B;P:p\\:q\\\\r;;');
});

test('Gastpfad verlangt das Token und verbietet Ausbrüche', () => {
  const token = '0123456789abcdef';
  assert.deepStrictEqual(resolveGuestPath(`/g/${token}/`, token), { ok: true, rel: '', websocket: false });
  assert.deepStrictEqual(resolveGuestPath(`/g/${token}`, token), { ok: true, rel: '', websocket: false, redirect: `/g/${token}/` });
  assert.deepStrictEqual(resolveGuestPath(`/g/${token}?x=1`, token), { ok: true, rel: '', websocket: false, redirect: `/g/${token}/?x=1` });
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
  assert.match(GUEST_SHIM_SOURCE, /showWifiQr/);
  assert.match(GUEST_SHIM_SOURCE, /showGameQr/);
  assert.match(GUEST_SHIM_SOURCE, /showHotspotQr/);
  assert.match(GUEST_SHIM_SOURCE, /acquire:\s*function/);
  assert.match(GUEST_SHIM_SOURCE, /release:\s*function/);
  assert.match(GUEST_SHIM_SOURCE, /spotify:\s*null/);
  assert.match(GUEST_SHIM_SOURCE, /storage:\s*null/);
  assert.match(GUEST_SHIM_SOURCE, /name = \(savedNow && savedNow\.name\) \|\| 'Gast';\s*connect\(\)/);
  const html = injectGuestDocument('<html><head></head><body>Spiel</body></html>', '0123456789abcdef', 'wolf', 'K7QP');
  assert.match(html, /<base href="\/g\/0123456789abcdef\/">/);
  assert.match(html, /openscr-guest-error/);
  assert.match(html, /Datei nicht geladen/);
  assert.match(html, /Kopieren/);
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
    read: async (rel) => {
      if (rel) return null;
      return { mime: 'text/html', body: utf8Encode('<html><head></head><body>Hi<script src="players.js"></script></body></html>') };
    },
    onLink() {},
  });
  try {
    const text = await httpGet(server.port, `/g/${token}/`);
    assert.match(text, /openscr-guest\.js/);
    assert.match(text, /Hi/);
    assert.match(text, /src="players\.js"/);
    const missing = await httpGet(server.port, '/g/0000000000000000/');
    assert.match(missing, /^HTTP\/1\.1 404/);
    const gone = await httpGet(server.port, `/g/${token}/fehlt.js`);
    assert.match(gone, /Nicht gefunden: fehlt\.js/);
  } finally {
    server.close();
  }
});

test('Gastserver liefert Shim, Skripte und Unterordner mit dem passenden Typ', async () => {
  const token = 'fdc394d2f43ecd6d';
  const files = new Map([
    ['players.js', { mime: 'application/octet-stream', body: utf8Encode('window.players=1;') }],
    ['stats.js', { mime: 'text/javascript', body: utf8Encode('window.stats=1;') }],
    ['multiplayer.js', { mime: 'text/javascript', body: utf8Encode('window.mp=1;') }],
    ['app.css', { mime: 'text/css', body: utf8Encode('body{color:red}') }],
    ['assets/icon.png', { mime: 'application/octet-stream', body: Uint8Array.from([137, 80, 78, 71, 1, 2, 3]) }],
    ['assets/sounds/correct.mp3', { mime: 'application/octet-stream', body: Uint8Array.from([255, 251, 144, 0, 1, 2]) }],
    ['assets/sounds/buzzer.mp3', { mime: 'audio/mpeg', body: Uint8Array.from([255, 251, 144, 4]) }],
    ['assets/sounds/wrong.mp3', { mime: 'audio/mpeg', body: Uint8Array.from([255, 251, 144, 5]) }],
  ]);
  const html = '<html><head></head><body><audio src="assets/sounds/correct.mp3"></audio><script src="players.js"></script><script src="stats.js"></script><script src="multiplayer.js"></script></body></html>';
  const server = await openGuestServer({
    token,
    appId: 'song',
    room: 'K7QP',
    listen: nodeListen,
    read: async (rel) => {
      if (!rel) return { mime: 'text/html', body: utf8Encode(html) };
      return files.get(rel) || null;
    },
    onLink() {},
  });
  try {
    const page = await httpGet(server.port, `/g/${token}/`);
    assert.match(page, /<base href="\/g\/fdc394d2f43ecd6d\/">/);
    assert.match(page, /src="players\.js"/);
    assert.match(page, /Datei nicht geladen/);
    const paths = [
      ['openscr-guest.js', 'text/javascript', 'OpenScrBridge'],
      ['players.js', 'text/javascript', 'window.players=1'],
      ['stats.js', 'text/javascript', 'window.stats=1'],
      ['multiplayer.js', 'text/javascript', 'window.mp=1'],
      ['app.css', 'text/css', 'color:red'],
      ['assets/sounds/correct.mp3', 'audio/mpeg', null],
      ['assets/sounds/buzzer.mp3', 'audio/mpeg', null],
      ['assets/sounds/wrong.mp3', 'audio/mpeg', null],
      ['assets/icon.png', 'image/png', null],
    ];
    const burst = paths.flatMap((item) => [item, item, item, item]);
    const responses = await Promise.all(burst.map(([path]) => httpGet(server.port, `/g/${token}/${path}`)));
    responses.forEach((raw, index) => {
      const [path, mime, snippet] = burst[index];
      assert.match(raw, /^HTTP\/1\.1 200/, path);
      assert.match(raw, new RegExp(`content-type: ${mime}`), path);
      assert.match(raw, /content-length: \d+/, path);
      if (snippet) assert.match(raw, new RegExp(snippet), path);
    });
    const mp3 = await httpGetRaw(server.port, `/g/${token}/assets/sounds/correct.mp3`);
    assert.deepStrictEqual(Array.from(mp3.subarray(mp3.length - 6)), [255, 251, 144, 0, 1, 2]);
  } finally {
    server.close();
  }
});

test('Antwort wird nicht verworfen, wenn das Socket erst nach dem Schreiben schließt', async () => {
  const token = '0123456789abcdef';
  let accept = null;
  const server = await openGuestServer({
    token,
    appId: 'song',
    room: 'K7QP',
    listen(onConnection) {
      accept = onConnection;
      return Promise.resolve({ port: 9, close() {} });
    },
    read: async (rel) => (rel ? { mime: 'text/plain', body: utf8Encode('ok-datei') } : null),
    onLink() {},
  });
  const queued = [];
  const conn = {
    sent: [],
    send(chunk) { queued.push(chunk); },
    drain() {
      this.sent.push(...queued.splice(0));
      return Promise.resolve();
    },
    close() { queued.splice(0); },
    onData(cb) { this.push = cb; },
    onClose() {},
  };
  try {
    accept(conn);
    conn.push(utf8Encode(`GET /g/${token}/players.js HTTP/1.1\r\nHost: phone\r\n\r\n`));
    await new Promise((resolve) => setImmediate(resolve));
    const raw = utf8Slice(conn.sent[0] || new Uint8Array());
    assert.match(raw, /200 OK/);
    assert.match(raw, /ok-datei/);
    assert.match(raw, /content-length: 8/);
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
    const bare = fakeConn();
    acceptGuest(bare);
    bare.push(utf8Encode(`GET /g/${token} HTTP/1.1\r\nHost: phone\r\n\r\n`));
    const moved = utf8Slice(bare.sent[0]);
    assert.match(moved, /302 Found/);
    assert.match(moved, new RegExp(`location: /g/${token}/`));
    const doc = fakeConn();
    acceptGuest(doc);
    doc.push(utf8Encode(`GET /g/${token}/ HTTP/1.1\r\nHost: phone\r\n\r\n`));
    await new Promise((resolve) => setImmediate(resolve));
    const page = utf8Slice(doc.sent[0]);
    assert.match(page, /200 OK/);
    assert.match(page, new RegExp(`<base href="/g/${token}/">`));
    assert.match(page, /openscr-guest\.js/);
    assert.match(page, /spiel/);
    const asset = fakeConn();
    acceptGuest(asset);
    asset.push(utf8Encode(`GET /g/${token}/openscr-guest.js HTTP/1.1\r\nHost: phone\r\n\r\n`));
    await new Promise((resolve) => setImmediate(resolve));
    const script = utf8Slice(asset.sent[0]);
    assert.match(script, /content-type: text\/javascript/);
    assert.match(script, /OpenScrBridge/);
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
    await sendMultiplayer('wolf', { type: 'buzz', n: 1 }, { to: welcome.playerId });
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
    assert.ok(replay.some((frame) => frame.t === 'msg' && frame.data.type === 'buzz' && frame.data.n === 1));

    const appGuest = makeAppLink();
    acceptApp(appGuest);
    appGuest.push(`${JSON.stringify({
      t: 'hello', v: 1, appId: 'wolf', room: hosted.roomCode, token, name: 'Cio',
    })}\n`);
    const appFrames = appGuest.sent.flatMap((chunk) => chunk.split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    assert.ok(appFrames.some((frame) => frame.t === 'welcome'));
    assert.ok(!appFrames.some((frame) => frame.t === 'msg'));
    const appWelcome = appFrames.find((frame) => frame.t === 'welcome');
    appGuest.close();
    await broadcastMultiplayer('wolf', { type: 'state', phase: 'vote' });
    const appAgain = makeAppLink();
    acceptApp(appAgain);
    appAgain.push(`${JSON.stringify({
      t: 'hello', v: 1, appId: 'wolf', room: hosted.roomCode, token, name: 'Cio',
      playerId: appWelcome.playerId, secret: appWelcome.secret,
    })}\n`);
    const appReplay = appAgain.sent.flatMap((chunk) => chunk.split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    assert.ok(appReplay.some((frame) => frame.t === 'msg' && frame.data.phase === 'vote'));
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
  return httpGetRaw(port, path).then((buf) => buf.toString('utf8'));
}

function httpGetRaw(port, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: phone\r\nConnection: close\r\n\r\n`);
    });
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks)));
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
