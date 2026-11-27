/**
 * HTTP- und WebSocket-Bausteine für Browser-Gäste.
 * Der Host spricht weiter das NDJSON-Protokoll. Der Browser bekommt dieselben Rahmen als WebSocket-Text.
 */
import { scriptJson } from '../../bridge/scriptJson';
import { GUEST_SHELL_SOURCE } from '../../shared/guestShellSource';
import { QRCODE_BROWSER_SOURCE } from '../../shared/qrcodeBrowserSource';
import { QR_SHELL_SOURCE } from '../../shared/qrShellSource';
import { ROSTER_LOBBY_SOURCE } from '../../shared/rosterLobbySource';
import { sameSecret } from './guard';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function encodeWifiQr(ssid: string, password: string): string {
  const name = String(ssid ?? '');
  if (!name) return '';
  const esc = (value: string) => value.replace(/([\\;,:"])/g, '\\$1');
  const secret = String(password ?? '');
  if (!secret) return `WIFI:T:nopass;S:${esc(name)};;`;
  return `WIFI:T:WPA;S:${esc(name)};P:${esc(secret)};;`;
}

export function gameUrl(ip: string, port: number, token: string): string {
  return `http://${ip}:${port}/g/${token}/`;
}

/** Join URL with the directory slash, so relative scrapp files resolve. */
export function shareableGameUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/');
    if (parts[1] === 'g' && parts[2] && parts.length === 3) parsed.pathname = `/g/${parts[2]}/`;
    return parsed.href;
  } catch {
    return url.endsWith('/') ? url : `${url}/`;
  }
}

const GUEST_ERROR_WATCH = `<script>(function(){function log(text){console.warn('[openscr-guest] '+text);}function broken(text){log(text);if(document.getElementById('openscr-guest-down'))return;var line=document.createElement('div');line.id='openscr-guest-down';line.setAttribute('style','position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:rgba(28,20,12,.9);color:#fff;padding:8px 10px;border-radius:10px;font:13px/1.3 sans-serif');line.textContent='Spiel konnte nicht laden.';(document.body||document.documentElement).appendChild(line);}window.addEventListener('error',function(event){var el=event.target;if(el&&el!==window){var url=el.currentSrc||el.src||el.href||'';log('Datei nicht geladen: '+url);if(String(el.tagName||'').toLowerCase()==='script')broken(url||'Skript');return;}var where=event.filename?' ('+event.filename+':'+(event.lineno||0)+')':'';broken(String((event.error&&event.error.message)||event.message||'Skriptfehler')+where);},true);window.addEventListener('unhandledrejection',function(event){var reason=event.reason;broken(String((reason&&reason.message)||reason||'Promise abgelehnt'));});})();</script>`;

const guestShellMeta = new Map<string, { name: string; repoUrl: string }>();

export function setGuestShellMeta(appId: string, meta: { name: string; repoUrl: string }): void {
  guestShellMeta.set(appId, { name: meta.name || '', repoUrl: meta.repoUrl || '' });
}

export function guestBootTags(token: string, appId: string, room: string): string {
  const meta = guestShellMeta.get(appId);
  const payload = scriptJson({ appId, room, name: meta?.name || '', repoUrl: meta?.repoUrl || '' });
  return `<base href="/g/${token}/">${GUEST_ERROR_WATCH}<script>window.__OPEN_SCR_GUEST__=${payload};</script><script>${QRCODE_BROWSER_SOURCE}</script><script>${ROSTER_LOBBY_SOURCE}</script><script>${QR_SHELL_SOURCE}</script><script>${GUEST_SHELL_SOURCE}</script><script src="openscr-guest.js"></script>`;
}

export function injectGuestDocument(html: string, token: string, appId: string, room: string): string {
  const tags = guestBootTags(token, appId, room);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => match + tags);
  return `<!DOCTYPE html><html><head>${tags}</head><body>${html}</body></html>`;
}

export interface GuestTarget {
  ok: true;
  rel: string;
  websocket: boolean;
  /** Slashless document URL. The browser must land on /g/<token>/ so relative files resolve. */
  redirect?: string;
}

export function resolveGuestPath(urlPath: string, token: string): GuestTarget | { ok: false; status: number; message: string } {
  const cut = urlPath.indexOf('?');
  const path = cut === -1 ? urlPath : urlPath.slice(0, cut);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return { ok: false, status: 400, message: 'Pfad ungültig.' };
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return { ok: false, status: 403, message: 'Pfad abgelehnt.' };
  const parts = decoded.split('/');
  if (parts[0] !== '' || parts[1] !== 'g' || !parts[2]) return { ok: false, status: 404, message: 'Nicht gefunden.' };
  if (!sameSecret(parts[2], token)) return { ok: false, status: 404, message: 'Nicht gefunden.' };
  const query = cut === -1 ? '' : urlPath.slice(cut);
  if (parts.length === 3) return { ok: true, rel: '', websocket: false, redirect: `/g/${parts[2]}/${query}` };
  const rest = parts.slice(3).join('/');
  if (!rest || rest === 'index.html') return { ok: true, rel: '', websocket: false };
  if (rest === 'ws') return { ok: true, rel: 'ws', websocket: true };
  if (rest.split('/').some((part) => part === '..' || part === '.')) return { ok: false, status: 403, message: 'Pfad abgelehnt.' };
  return { ok: true, rel: rest, websocket: false };
}

export interface HttpHead {
  method: string;
  target: string;
  headers: Record<string, string>;
  rest: Uint8Array;
}

export function parseHttpHead(buffer: Uint8Array): HttpHead | null | { error: string } {
  const marker = findDoubleCrlf(buffer);
  if (marker < 0) {
    if (buffer.length > 16 * 1024) return { error: 'Kopf zu groß.' };
    return null;
  }
  const head = utf8Slice(buffer.subarray(0, marker));
  const lines = head.split('\r\n');
  const request = lines.shift() || '';
  const match = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(request);
  if (!match) return { error: 'Keine HTTP-Anfrage.' };
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { method: match[1], target: match[2], headers, rest: buffer.slice(marker + 4) };
}

function rotl(n: number, s: number): number {
  return ((n << s) | (n >>> (32 - s))) >>> 0;
}

/** SHA-1, enough for the WebSocket accept key. Metro cannot bundle Node's crypto. */
function sha1Bytes(input: Uint8Array): Uint8Array {
  const length = input.length;
  const blocks = Math.ceil((length + 9) / 64) * 64;
  const data = new Uint8Array(blocks);
  data.set(input);
  data[length] = 0x80;
  const view = new DataView(data.buffer);
  const bits = length * 8;
  view.setUint32(blocks - 8, Math.floor(bits / 0x100000000));
  view.setUint32(blocks - 4, bits >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < blocks; offset += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 80; t += 1) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t += 1) {
      let f = 0;
      let k = 0;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const hashed = new DataView(out.buffer);
  hashed.setUint32(0, h0);
  hashed.setUint32(4, h1);
  hashed.setUint32(8, h2);
  hashed.setUint32(12, h3);
  hashed.setUint32(16, h4);
  return out;
}

function base64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    text += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    text += i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=';
    text += i + 2 < bytes.length ? alphabet[n & 63] : '=';
  }
  return text;
}

export function wsAcceptKey(clientKey: string): string {
  return base64(sha1Bytes(utf8Encode(`${clientKey}${WS_GUID}`)));
}

export function redirectResponse(location: string): Uint8Array {
  return httpBytes(302, 'Found', { location, 'content-type': 'text/plain; charset=utf-8' }, utf8Encode(''));
}

export function httpBytes(status: number, reason: string, headers: Record<string, string>, body: Uint8Array): Uint8Array {
  const lines = [`HTTP/1.1 ${status} ${reason}`];
  const all: Record<string, string> = {
    'content-length': String(body.length),
    connection: 'close',
    'cache-control': 'no-store',
    ...headers,
  };
  Object.keys(all).forEach((key) => lines.push(`${key}: ${all[key]}`));
  const head = utf8Encode(`${lines.join('\r\n')}\r\n\r\n`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

export function upgradeResponse(clientKey: string): Uint8Array {
  return httpBytes(101, 'Switching Protocols', {
    upgrade: 'websocket',
    connection: 'Upgrade',
    'sec-websocket-accept': wsAcceptKey(clientKey),
  }, new Uint8Array());
}

export interface WsFrame {
  opcode: number;
  payload: Uint8Array;
}

export function encodeWsFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const len = payload.length;
  let header: number;
  if (len < 126) header = 2;
  else if (len < 65536) header = 4;
  else header = 10;
  const out = new Uint8Array(header + len);
  out[0] = 0x80 | (opcode & 0x0f);
  if (len < 126) out[1] = len;
  else if (len < 65536) {
    out[1] = 126;
    out[2] = (len >> 8) & 0xff;
    out[3] = len & 0xff;
  } else {
    out[1] = 127;
    const view = new DataView(out.buffer);
    view.setUint32(2, Math.floor(len / 0x100000000));
    view.setUint32(6, len >>> 0);
  }
  out.set(payload, header);
  return out;
}

export function decodeWsFrames(buffer: Uint8Array): { frames: WsFrame[]; rest: Uint8Array; error?: string } {
  const frames: WsFrame[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) return { frames, rest: buffer.slice(offset) };
      length = (buffer[cursor] << 8) | buffer[cursor + 1];
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) return { frames, rest: buffer.slice(offset) };
      const hi = (buffer[cursor] * 0x1000000) + (buffer[cursor + 1] << 16) + (buffer[cursor + 2] << 8) + buffer[cursor + 3];
      if (hi !== 0) return { frames, rest: new Uint8Array(), error: 'Rahmen zu groß.' };
      length = ((buffer[cursor + 4] * 0x1000000) + (buffer[cursor + 5] << 16) + (buffer[cursor + 6] << 8) + buffer[cursor + 7]) >>> 0;
      cursor += 8;
    }
    if (length > 64 * 1024) return { frames, rest: new Uint8Array(), error: 'Rahmen zu groß.' };
    const maskLen = masked ? 4 : 0;
    if (cursor + maskLen + length > buffer.length) return { frames, rest: buffer.slice(offset) };
    const payload = buffer.subarray(cursor + maskLen, cursor + maskLen + length);
    const data = new Uint8Array(payload.length);
    if (masked) {
      const mask = buffer.subarray(cursor, cursor + 4);
      for (let i = 0; i < payload.length; i++) data[i] = payload[i] ^ mask[i % 4];
    } else data.set(payload);
    frames.push({ opcode, payload: data });
    offset = cursor + maskLen + length;
    if (frames.length > 32) return { frames, rest: new Uint8Array(), error: 'Zu viele Rahmen.' };
  }
  return { frames, rest: buffer.slice(offset) };
}

export function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

export function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8Slice(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function findDoubleCrlf(buffer: Uint8Array): number {
  for (let i = 0; i + 3 < buffer.length; i++) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) return i;
  }
  return -1;
}

/** Gast-Brücke. Dieselbe Multiplayer-API, ohne native Gerätefunktionen. */
export const GUEST_SHIM_SOURCE = `(function () {
  var cfg = window.__OPEN_SCR_GUEST__ || {};
  var match = String(location.pathname || '').match(/\\/g\\/([0-9a-fA-F]+)/);
  var token = match ? match[1] : '';
  var storageKey = 'openscr-guest:' + token;
  var listeners = {};
  var socket = null;
  var welcomed = false;
  var selfId = '';
  var secret = '';
  var roomCode = String(cfg.room || '');
  var appId = String(cfg.appId || '');
  var players = [];
  var name = '';
  var outbox = [];
  var resumeWaiters = [];
  var joinWaiters = [];
  var reconnectTimer = null;
  var attempt = 0;
  var giveUp = false;
  var resumeTimer = null;
  var pendingResume = null;

  function emit(event, data) {
    (listeners[event] || []).slice().forEach(function (cb) {
      try { cb(data); } catch (err) {}
    });
  }
  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
    return function () { off(event, cb); };
  }
  function off(event, cb) {
    listeners[event] = (listeners[event] || []).filter(function (item) { return item !== cb; });
  }
  function readIdentity() {
    try {
      var raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }
  function writeIdentity() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ playerId: selfId, secret: secret, name: name, roomCode: roomCode }));
    } catch (err) {}
  }
  function clearIdentity() {
    try { localStorage.removeItem(storageKey); } catch (err) {}
    selfId = '';
    secret = '';
  }
  function view(status) {
    return { role: 'guest', roomCode: roomCode, selfId: selfId, players: players, status: status };
  }
  function settleJoin(value, error) {
    var waiters = joinWaiters;
    joinWaiters = [];
    waiters.forEach(function (waiter) { error ? waiter.reject(error) : waiter.resolve(value); });
  }
  function settleResume(value) {
    var waiters = resumeWaiters;
    resumeWaiters = [];
    waiters.forEach(function (waiter) { waiter(value); });
  }
  function scheduleResumed(info) {
    pendingResume = info;
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(function () {
      resumeTimer = null;
      var payload = pendingResume;
      pendingResume = null;
      if (!payload) return;
      emit('multiplayer.resumed', payload);
      settleResume(payload);
    }, 40);
  }
  function wsUrl() {
    var base = document.querySelector('base');
    var href = base && base.href ? base.href : location.href;
    if (href.slice(-1) !== '/') href += '/';
    return href.replace(/^http/i, 'ws') + 'ws';
  }
  function socketSend(text) {
    if (socket && socket.readyState === 1) socket.send(text);
  }
  function rememberOut(text) {
    outbox.push(text);
    if (outbox.length > 32) outbox.shift();
  }
  function flushOutbox() {
    if (!welcomed) return;
    while (outbox.length) socketSend(outbox.shift());
  }
  var bins = {};
  function takeBin(frame) {
    var id = String(frame.id || '');
    var slot = bins[id];
    if (!slot || slot.n !== frame.n) slot = bins[id] = { n: frame.n, parts: [], got: 0 };
    if (slot.parts[frame.i] == null) { slot.parts[frame.i] = frame.b; slot.got += 1; }
    emit('multiplayer.binaryProgress', { id: id, from: frame.from, received: slot.got, total: frame.n });
    if (slot.got !== frame.n) return;
    var bytes = [];
    for (var i = 0; i < slot.n; i++) {
      var bin = atob(slot.parts[i] || '');
      for (var j = 0; j < bin.length; j++) bytes.push(bin.charCodeAt(j) & 255);
    }
    delete bins[id];
    emit('multiplayer.binary', { id: id, from: frame.from, bytes: new Uint8Array(bytes) });
  }
  function u8ToB64(bytes) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      var n = (a << 16) | (b << 8) | c;
      out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
      out += (i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '=');
    }
    return out;
  }
  function sendRaw(frame) {
    var text = JSON.stringify(frame);
    if (frame.t !== 'hello' && !welcomed) { rememberOut(text); return; }
    if (socket && socket.readyState === 1) socketSend(text);
    else if (frame.t !== 'hello') rememberOut(text);
  }
  function helloFrame() {
    var saved = readIdentity();
    var hello = { t: 'hello', v: 1, appId: appId, room: roomCode, token: token, name: name || (saved && saved.name) || 'Gast' };
    if (saved && saved.secret && saved.playerId) {
      hello.playerId = saved.playerId;
      hello.secret = saved.secret;
      if (!name) name = saved.name || hello.name;
      hello.name = name;
    }
    return hello;
  }
  function handleFrame(frame) {
    if (!frame || typeof frame !== 'object') return;
    if (frame.t === 'welcome') {
      welcomed = true;
      attempt = 0;
      selfId = frame.playerId || selfId;
      secret = frame.secret || secret;
      players = frame.players || [];
      writeIdentity();
      hideName();
      emit('multiplayer.players', { players: players, selfId: selfId, roomCode: roomCode });
      settleJoin({ roomCode: roomCode, qrPayload: '', gameUrl: '', playerId: selfId, players: players });
      flushOutbox();
      scheduleResumed(view('ready'));
      return;
    }
    if (frame.t === 'players') {
      players = frame.players || [];
      emit('multiplayer.players', { players: players, selfId: selfId, roomCode: roomCode });
      return;
    }
    if (frame.t === 'msg') {
      emit('multiplayer.message', { from: frame.from, data: frame.data });
      return;
    }
    if (frame.t === 'bin') {
      takeBin(frame);
      return;
    }
    if (frame.t === 'ping') {
      sendRaw({ t: 'pong', ts: frame.ts });
      return;
    }
    if (frame.t === 'error') {
      var fatal = frame.code === 'auth' || frame.code === 'ended' || frame.code === 'denied' || frame.code === 'full' || frame.code === 'player';
      if (fatal) {
        giveUp = true;
        if (frame.code === 'ended' || frame.code === 'auth') clearIdentity();
      }
      settleJoin(null, new Error(frame.message || 'Verbindung abgelehnt.'));
      if (!welcomed) settleResume(null);
    }
  }
  function connect() {
    if (giveUp || !token || !appId) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    var hello = helloFrame();
    var ws;
    try { ws = new WebSocket(wsUrl()); }
    catch (err) { scheduleReconnect(); return; }
    socket = ws;
    welcomed = false;
    ws.onopen = function () { ws.send(JSON.stringify(hello)); };
    ws.onmessage = function (ev) {
      var frame;
      try { frame = JSON.parse(String(ev.data)); } catch (err) { return; }
      handleFrame(frame);
    };
    ws.onclose = function () {
      if (socket !== ws) return;
      socket = null;
      if (giveUp) return;
      if (selfId) {
        emit('multiplayer.hostAway', { roomCode: roomCode, message: 'Host ist kurz weg' });
        settleResume(view('hostAway'));
      }
      scheduleReconnect();
    };
  }
  function scheduleReconnect() {
    if (giveUp || reconnectTimer) return;
    var wait = Math.min(15000, 400 * Math.pow(2, Math.min(attempt, 6)));
    attempt += 1;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, wait);
  }
  function unavailable() {
    return Promise.reject(new Error('Im Browser-Gast nicht verfügbar.'));
  }
  function guestOnly() {
    return Promise.reject(new Error('Im Browser ist nur die Gast-Ansicht da.'));
  }
  function stub() {
    function fn() { return unavailable(); }
    return new Proxy(fn, { get: function () { return stub(); } });
  }
  function hideName() {
    var box = document.getElementById('openscr-guest-name');
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }
  function showName() {
    if (document.getElementById('openscr-guest-name')) return;
    var box = document.createElement('form');
    box.id = 'openscr-guest-name';
    box.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#0f1115;color:#fff;padding:12px;border-radius:12px;font:16px sans-serif');
    var label = document.createElement('div');
    label.textContent = 'Dein Name im Spiel';
    var input = document.createElement('input');
    input.maxLength = 24;
    input.value = name || 'Gast';
    input.setAttribute('style', 'display:block;width:100%;margin:8px 0;padding:8px;box-sizing:border-box;font:inherit');
    var button = document.createElement('button');
    button.type = 'submit';
    button.textContent = 'Mitspielen';
    button.setAttribute('style', 'font:inherit;padding:10px 14px;border:0;border-radius:10px;background:#2f6fed;color:#fff');
    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(button);
    box.onsubmit = function (ev) {
      ev.preventDefault();
      name = String(input.value || 'Gast').slice(0, 24);
      connect();
    };
    (document.body || document.documentElement).appendChild(box);
  }
  function begin(nextName) {
    if (nextName) name = String(nextName).slice(0, 24);
    if (welcomed && socket && socket.readyState === 1) {
      return Promise.resolve({ roomCode: roomCode, qrPayload: '', gameUrl: '', playerId: selfId, players: players });
    }
    connect();
    return new Promise(function (resolve, reject) { joinWaiters.push({ resolve: resolve, reject: reject }); });
  }
  var mp = {
    host: function () { return guestOnly(); },
    join: function (input) {
      var next = input && typeof input === 'object' ? input.name : '';
      return begin(next);
    },
    send: function (data, opts) {
      sendRaw({ t: 'msg', to: opts && opts.to ? opts.to : undefined, data: data });
      return Promise.resolve({ seq: 0 });
    },
    broadcast: function (data) {
      sendRaw({ t: 'msg', all: true, data: data });
      return Promise.resolve({ seq: 0 });
    },
    sendBinary: function (opts) {
      opts = opts || {};
      var bytes = opts.bytes instanceof Uint8Array ? opts.bytes : new Uint8Array(opts.bytes || []);
      if (opts.base64 && !opts.bytes) {
        var bin = atob(opts.base64);
        bytes = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k) & 255;
      }
      if (bytes.length > 262144) return Promise.reject(new Error('Binärdaten sind zu groß (höchstens 256 KiB).'));
      var chunk = 12000;
      var n = Math.ceil(bytes.length / chunk);
      var id = String(opts.id || 'bin');
      for (var i = 0; i < n; i++) {
        var slice = bytes.subarray(i * chunk, Math.min(bytes.length, (i + 1) * chunk));
        sendRaw({ t: 'bin', id: id, i: i, n: n, b: u8ToB64(slice), to: opts.to, all: opts.to ? undefined : true });
      }
      return Promise.resolve({ id: id, chunks: n, byteLength: bytes.length });
    },
    leave: function () {
      sendRaw({ t: 'leave' });
      giveUp = true;
      clearIdentity();
      if (socket) socket.close();
      return Promise.resolve({ left: true });
    },
    showQr: function () { return guestOnly(); },
    showWifiQr: function () { return guestOnly(); },
    showGameQr: function () { return guestOnly(); },
    showHotspotQr: function () { return guestOnly(); },
    discover: function () { return guestOnly(); },
    stopDiscovery: function () { return guestOnly(); },
    setDiscoverable: function () { return guestOnly(); },
    approveJoin: function () { return guestOnly(); },
    denyJoin: function () { return guestOnly(); },
    endRoom: function () { return guestOnly(); },
    resume: function () {
      var saved = readIdentity();
      if (saved && saved.name && !name) name = saved.name;
      if (!name) name = 'Gast';
      if (welcomed && selfId && socket && socket.readyState === 1) return Promise.resolve(view('ready'));
      connect();
      return new Promise(function (resolve) { resumeWaiters.push(resolve); });
    },
    onMessage: function (cb) { return on('multiplayer.message', cb); },
    onPlayersChanged: function (cb) { return on('multiplayer.players', cb); },
    onJoinRequest: function (cb) { return on('multiplayer.joinRequest', cb); },
    onResumed: function (cb) { return on('multiplayer.resumed', cb); },
    onHostAway: function (cb) { return on('multiplayer.hostAway', cb); },
  };
  var bridge = {
    guest: true,
    buildInfo: { environment: 'browser-guest', buildType: 'browser' },
    multiplayer: mp,
    events: { on: on, off: off },
    storage: null,
    secrets: stub(),
    http: stub(),
    bluetooth: stub(),
    notifications: stub(),
    camera: stub(),
    sensors: stub(),
    vibration: stub(),
    background: stub(),
    ble: stub(),
    net: stub(),
    popup: stub(),
    tiles: stub(),
    spotify: null,
    clipboard: stub(),
    share: stub(),
    network: stub(),
    media: stub(),
    crypto: stub(),
    screen: { keepAwake: function () { return Promise.resolve({ on: false }); } },
    keepAwake: {
      acquire: function () { return Promise.resolve({ on: false }); },
      release: function () { return Promise.resolve({ on: false }); },
    },
  };
  window.OpenScrBridge = bridge;
  window.EveryAppBridge = bridge;
  var savedNow = readIdentity();
  name = (savedNow && savedNow.name) || 'Gast';
  connect();
})();
`;
