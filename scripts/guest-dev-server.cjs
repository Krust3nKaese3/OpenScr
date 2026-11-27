/**
 * Dev-only guest server. The browser cannot listen, so Metro starts this
 * process-local HTTP and WebSocket server. Phones on the LAN open /g/<token>/.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (global.__openscrGuestDev) {
  module.exports = global.__openscrGuestDev;
} else {
  const PORT = 8791;
  const rooms = new Map();

  function lanIp() {
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const net of list || []) {
        const v4 = net.family === 'IPv4' || net.family === 4;
        if (!v4 || net.internal) continue;
        return net.address;
      }
    }
    return '127.0.0.1';
  }

  function acceptKey(key) {
    return crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  }

  function sendText(socket, text) {
    const payload = Buffer.from(String(text), 'utf8');
    const header = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.concat([Buffer.from([0x81, 126]), Buffer.from([(payload.length >> 8) & 255, payload.length & 255])]);
    socket.write(Buffer.concat([header, payload]));
  }

  function readFrames(buffer) {
    const texts = [];
    let offset = 0;
    let closed = false;
    while (buffer.length - offset >= 2) {
      const b0 = buffer[offset];
      const b1 = buffer[offset + 1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let length = b1 & 0x7f;
      let start = offset + 2;
      if (length === 126) {
        if (buffer.length - start < 2) break;
        length = buffer.readUInt16BE(start);
        start += 2;
      } else if (length === 127) break;
      const maskLen = masked ? 4 : 0;
      if (buffer.length - start < maskLen + length) break;
      let payload = buffer.subarray(start + maskLen, start + maskLen + length);
      if (masked) {
        const mask = buffer.subarray(start, start + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      offset = start + maskLen + length;
      if (opcode === 8) closed = true;
      if (opcode === 1) texts.push(payload.toString('utf8'));
    }
    return { texts, rest: buffer.subarray(offset), closed };
  }

  function attach(socket, onText, onClose) {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = readFrames(buffer);
      buffer = parsed.rest;
      parsed.texts.forEach((text) => onText(text));
      if (parsed.closed) socket.end();
    });
    socket.on('close', onClose);
    socket.on('end', onClose);
    socket.on('error', onClose);
  }

  function dirStamp(root) {
    const files = [];
    try { walk(root, root, files); } catch { return 'leer'; }
    return crypto.createHash('sha1').update(files.map((file) => `${file.rel}:${file.mtime}:${file.size}`).join('\n')).digest('hex');
  }

  function liveHtml(room, token, raw) {
    let html = raw.toString('utf8');
    const reload = `<script>(function(){var s='';function tick(){fetch('/g/${token}/openscr-dev-stamp',{cache:'no-store'}).then(function(r){return r.text();}).then(function(n){if(s&&n&&n!==s)location.reload();s=n;}).catch(function(){});}setInterval(tick,500);tick();})();</script>`;
    if (html.indexOf('openscr-dev-stamp') >= 0) return Buffer.from(html);
    const extra = (html.indexOf('openscr-guest.js') < 0 ? room.boot : '') + reload;
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (match) => match + extra);
    else html = `<!DOCTYPE html><html><head>${extra}</head><body>${html}</body></html>`;
    return Buffer.from(html);
  }

  function liveFile(room, key, token) {
    if (!room.root) return null;
    const full = inside(room.root, key || 'index.html');
    if (!full) return null;
    let stat;
    try { stat = fs.statSync(full); } catch { return null; }
    if (!stat.isFile()) return null;
    const ext = path.extname(full).slice(1).toLowerCase();
    let body = fs.readFileSync(full);
    let mime = MIME[ext] || 'application/octet-stream';
    if (!key) {
      body = liveHtml(room, token, body);
      mime = 'text/html; charset=utf-8';
    }
    return { mime, body };
  }

  function roomOf(token) {
    return rooms.get(token) || null;
  }

  function loopback(req) {
    const ip = req.socket.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  const MIME = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8', json: 'application/json',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav',
    txt: 'text/plain; charset=utf-8', webmanifest: 'application/manifest+json',
  };

  function safeRoot(raw) {
    const root = path.resolve(String(raw || ''));
    if (!path.isAbsolute(root)) return null;
    let stat;
    try { stat = fs.statSync(root); } catch { return null; }
    if (!stat.isDirectory()) return null;
    return root;
  }

  function inside(root, rel) {
    const clean = String(rel || '').replace(/\\/g, '/');
    if (clean.split('/').some((part) => part === '..' || part === '.')) return null;
    const full = path.resolve(root, clean);
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (full !== root && !full.startsWith(prefix)) return null;
    return full;
  }

  function walk(root, dir, out) {
    if (out.length > 400) return;
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(root, full, out);
      else if (stat.isFile() && stat.size <= 8_000_000) {
        out.push({ rel: path.relative(root, full).split(path.sep).join('/'), mtime: stat.mtimeMs, size: stat.size });
      }
    }
  }

  function serveDevDir(req, res, url) {
    if (!loopback(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nur von diesem Rechner.');
      return true;
    }
    const root = safeRoot(url.searchParams.get('root'));
    if (!root) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Diesen Ordner gibt es auf dem PC nicht. Pfad prüfen.');
      return true;
    }
    const files = [];
    walk(root, root, files);
    const stamp = crypto.createHash('sha1').update(files.map((file) => `${file.rel}:${file.mtime}:${file.size}`).join('\n')).digest('hex');
    if (url.searchParams.get('list') === '1') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ stamp, files: files.map((file) => file.rel) }));
      return true;
    }
    const rel = url.searchParams.get('rel') || '';
    const full = inside(root, rel);
    if (!full) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Pfad abgelehnt.');
      return true;
    }
    let body;
    try { body = fs.readFileSync(full); } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden.');
      return true;
    }
    const ext = path.extname(full).slice(1).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const text = mime.startsWith('text/') || mime.includes('javascript') || mime.includes('json') || mime.includes('svg')
      ? body.toString('utf8')
      : null;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ mime, base64: body.toString('base64'), text, stamp }));
    return true;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/openscr-dev-dir') {
      serveDevDir(req, res, url);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/openscr-dev-guest') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const token = String(body.token || '');
          if (!/^[a-f0-9]{16}$/.test(token)) throw new Error('Token fehlt.');
          const files = new Map();
          for (const file of body.files || []) {
            files.set(String(file.path || ''), {
              mime: String(file.mime || 'application/octet-stream'),
              body: Buffer.from(String(file.base64 || ''), 'base64'),
            });
          }
          const previous = rooms.get(token);
          const root = safeRoot(body.root);
          rooms.set(token, {
            appId: String(body.appId || ''),
            room: String(body.room || ''),
            root,
            boot: String(body.boot || ''),
            files,
            hosts: previous ? previous.hosts : new Set(),
            guests: previous ? previous.guests : new Map(),
            pending: previous ? previous.pending : new Map(),
          });
          const ip = lanIp();
          console.log(`[openscr-guest-dev] Raum ${body.room} auf http://${ip}:${PORT}/g/${token}/`);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ port: PORT, ip }));
        } catch (error) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(error instanceof Error ? error.message : 'Ungültig.');
        }
      });
      return;
    }
    const parts = url.pathname.split('/');
    if (parts[1] !== 'g' || !parts[2]) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Nicht gefunden.');
      return;
    }
    const room = roomOf(parts[2]);
    if (!room) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Nicht gefunden.');
      return;
    }
    if (parts.length === 3) {
      res.writeHead(302, { location: `/g/${parts[2]}/` });
      res.end();
      return;
    }
    const rel = parts.slice(3).join('/');
    if (rel === 'openscr-dev-stamp') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(room.root ? dirStamp(room.root) : 'snap');
      return;
    }
    if (rel === 'ws') {
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('WebSocket.');
      return;
    }
    const key = !rel || rel === 'index.html' ? '' : rel;
    const live = liveFile(room, key, parts[2]);
    const file = live || room.files.get(key);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Nicht gefunden: ${rel || '/'}`);
      return;
    }
    res.writeHead(200, { 'content-type': file.mime, 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : file.body);
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    if (url.pathname === '/openscr-dev-host') {
      const token = url.searchParams.get('token') || '';
      const room = roomOf(token);
      if (!room) {
        socket.destroy();
        return;
      }
      room.hosts.add(socket);
      room.guests.forEach((guest, id) => {
        sendText(socket, JSON.stringify({ t: 'guest', id }));
        (room.pending.get(id) || []).forEach((line) => {
          sendText(socket, JSON.stringify({ t: 'text', id, data: line }));
        });
        room.pending.delete(id);
      });
      attach(socket, (text) => {
        let message;
        try { message = JSON.parse(text); } catch { return; }
        const guest = room.guests.get(message.id);
        if (!guest) return;
        if (message.t === 'text') sendText(guest, message.data);
        if (message.t === 'close') guest.end();
      }, () => {
        room.hosts.delete(socket);
        if (room.hosts.size === 0) {
          room.guests.forEach((guest) => {
            try { guest.end(); } catch { /* Der Tab verbindet sich neu. */ }
          });
        }
      });
      return;
    }
    const parts = url.pathname.split('/');
    if (parts[1] !== 'g' || parts[3] !== 'ws') {
      socket.destroy();
      return;
    }
    const room = roomOf(parts[2]);
    if (!room) {
      socket.destroy();
      return;
    }
    const id = crypto.randomBytes(4).toString('hex');
    room.guests.set(id, socket);
    room.hosts.forEach((host) => sendText(host, JSON.stringify({ t: 'guest', id })));
    attach(socket, (text) => {
      if (room.hosts.size === 0) {
        const queued = room.pending.get(id) || [];
        queued.push(text);
        if (queued.length > 32) queued.shift();
        room.pending.set(id, queued);
        return;
      }
      room.hosts.forEach((host) => sendText(host, JSON.stringify({ t: 'text', id, data: text })));
    }, () => {
      room.guests.delete(id);
      room.pending.delete(id);
      room.hosts.forEach((host) => sendText(host, JSON.stringify({ t: 'close', id })));
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[openscr-guest-dev] hört auf ${PORT}, LAN ${lanIp()}`);
  });
  server.on('error', (error) => {
    console.warn(`[openscr-guest-dev] ${error.message}`);
  });
  global.__openscrGuestDev = { port: PORT };
  module.exports = global.__openscrGuestDev;
}
