/**
 * Kleiner HTTP- und WebSocket-Server auf einem Byte-Socket.
 * In der App ist das react-native-tcp-socket. Tests benutzen einen Ersatz.
 */
import type { MpLink } from './transport';
import { isTextMime, parentDir, rewriteHtmlAssets } from '../miniAppFiles';
import {
  GUEST_SHIM_SOURCE,
  concatBytes,
  decodeWsFrames,
  encodeWsFrame,
  gameUrl,
  httpBytes,
  injectGuestDocument,
  parseHttpHead,
  redirectResponse,
  resolveGuestPath,
  upgradeResponse,
  utf8Encode,
  utf8Slice,
} from './guestHttp';

export interface ByteConn {
  send(chunk: Uint8Array): void;
  close(): void;
  onData(cb: (chunk: Uint8Array) => void): void;
  onClose(cb: () => void): void;
}

export interface ByteListen {
  (onConnection: (conn: ByteConn) => void, port: number): Promise<{ port: number; close(): void }>;
}

export interface GuestFile {
  mime: string;
  body: Uint8Array;
}

export interface GuestServer {
  port: number;
  close(): void;
  url(ip: string): string;
}

const MAX_FILE = 8 * 1024 * 1024;
const MAX_CONN = 32;

export async function openGuestServer(opts: {
  token: string;
  appId: string;
  room: string;
  preferredPort?: number;
  listen: ByteListen;
  entry?: string;
  read: (rel: string) => Promise<GuestFile | null>;
  onLink: (link: MpLink) => void;
}): Promise<GuestServer> {
  const live = new Set<ByteConn>();
  const onConnection = (conn: ByteConn) => {
    if (live.size >= MAX_CONN) {
      conn.close();
      return;
    }
    live.add(conn);
    bindHttp(conn, opts, () => live.delete(conn));
  };
  const preferred = opts.preferredPort && opts.preferredPort >= 1024 ? opts.preferredPort : 0;
  let server: { port: number; close(): void };
  try {
    server = await opts.listen(onConnection, preferred);
  } catch (error) {
    if (!preferred) throw error;
    server = await opts.listen(onConnection, 0);
  }
  return {
    port: server.port,
    close() {
      live.forEach((conn) => conn.close());
      live.clear();
      server.close();
    },
    url(ip: string) {
      return gameUrl(ip, server.port, opts.token);
    },
  };
}

function bindHttp(
  conn: ByteConn,
  opts: { token: string; appId: string; room: string; entry?: string; read: (rel: string) => Promise<GuestFile | null>; onLink: (link: MpLink) => void },
  done: () => void,
): void {
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let mode: 'http' | 'file' | 'ws' | 'dead' = 'http';
  let link: ReturnType<typeof createBrowserLink> | null = null;
  const fail = () => {
    if (mode === 'dead') return;
    mode = 'dead';
    link?.fireClose();
    conn.close();
    done();
  };
  conn.onClose(fail);
  conn.onData((chunk) => {
    if (mode === 'dead' || mode === 'file') return;
    buffer = concatBytes(buffer, chunk);
    if (buffer.length > MAX_FILE) {
      fail();
      return;
    }
    if (mode === 'http') {
      const head = parseHttpHead(buffer);
      if (!head) return;
      if ('error' in head) {
        conn.send(textResponse(400, head.error));
        fail();
        return;
      }
      buffer = head.rest;
      if (head.method !== 'GET') {
        conn.send(textResponse(405, 'Nur GET.'));
        fail();
        return;
      }
      const target = resolveGuestPath(head.target, opts.token);
      if (!target.ok) {
        conn.send(textResponse(target.status, target.message));
        fail();
        return;
      }
      if (target.redirect) {
        conn.send(redirectResponse(target.redirect));
        fail();
        return;
      }
      if (target.websocket) {
        const key = head.headers['sec-websocket-key'] || '';
        if (head.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
          conn.send(textResponse(400, 'Kein WebSocket.'));
          fail();
          return;
        }
        conn.send(upgradeResponse(key));
        mode = 'ws';
        link = createBrowserLink(conn, fail);
        opts.onLink(link.link);
        if (buffer.length) consumeWs(buffer);
        buffer = link.takeRest();
        return;
      }
      mode = 'file';
      void serveFile(opts, target.rel).then((bytes) => {
        conn.send(bytes);
        fail();
      }).catch(() => {
        conn.send(textResponse(500, 'Datei nicht lesbar.'));
        fail();
      });
      return;
    }
    consumeWs(buffer);
    buffer = link ? link.takeRest() : new Uint8Array();
  });

  function consumeWs(bytes: Uint8Array) {
    if (!link) return;
    const decoded = decodeWsFrames(bytes);
    link.setRest(decoded.rest);
    if (decoded.error) {
      fail();
      return;
    }
    for (const frame of decoded.frames) {
      if (frame.opcode === 8) {
        fail();
        return;
      }
      if (frame.opcode === 9) {
        conn.send(encodeWsFrame(10, frame.payload));
        continue;
      }
      if (frame.opcode === 10) continue;
      if (frame.opcode !== 1) continue;
      link.pushText(utf8Slice(frame.payload));
    }
  }
}

async function serveFile(
  opts: { token: string; appId: string; room: string; entry?: string; read: (rel: string) => Promise<GuestFile | null> },
  rel: string,
): Promise<Uint8Array> {
  if (rel === 'openscr-guest.js') {
    return httpBytes(200, 'OK', { 'content-type': 'text/javascript; charset=utf-8' }, utf8Encode(GUEST_SHIM_SOURCE));
  }
  const file = await opts.read(rel);
  if (!file) {
    if (rel) return textResponse(404, `Nicht gefunden: ${rel}`);
    const html = injectGuestDocument('<p>Die OpenScrapp ist noch nicht geladen.</p>', opts.token, opts.appId, opts.room);
    return httpBytes(200, 'OK', { 'content-type': 'text/html; charset=utf-8' }, utf8Encode(html));
  }
  if (file.body.length > MAX_FILE) return textResponse(413, 'Datei zu groß.');
  const mime = file.mime || 'application/octet-stream';
  let payload = file.body;
  if (mime.startsWith('text/html')) {
    const baseDir = parentDir(rel || opts.entry || '');
    const inlined = await inlineGuestHtml(utf8Slice(file.body), baseDir, opts.read);
    payload = utf8Encode(injectGuestDocument(inlined, opts.token, opts.appId, opts.room));
  }
  const type = mime.startsWith('text/') || mime.includes('javascript') || mime.includes('json') ? `${mime}; charset=utf-8` : mime;
  return httpBytes(200, 'OK', { 'content-type': type }, payload);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Dieselben lokalen Dateien wie die WebView einbetten, damit der Desktop-Browser sie nicht extra laden muss. */
async function inlineGuestHtml(html: string, baseDir: string, read: (rel: string) => Promise<GuestFile | null>): Promise<string> {
  try {
    return await rewriteHtmlAssets(html, baseDir, 'openscr.guest', async (rel) => {
      const file = await read(rel);
      if (!file) return null;
      return {
        mime: file.mime,
        base64: bytesToBase64(file.body),
        text: isTextMime(file.mime) ? utf8Slice(file.body) : null,
      };
    });
  } catch {
    return html;
  }
}

function textResponse(status: number, message: string): Uint8Array {
  const reason = status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : status === 405 ? 'Method Not Allowed' : status === 413 ? 'Payload Too Large' : 'Bad Request';
  return httpBytes(status, reason, { 'content-type': 'text/plain; charset=utf-8' }, utf8Encode(message));
}

function createBrowserLink(conn: ByteConn, fail: () => void) {
  let rest = new Uint8Array();
  const dataListeners: ((chunk: string) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  let closed = false;
  const link: MpLink = {
    browser: true,
    send(frame) {
      if (closed) return;
      String(frame).split('\n').forEach((line) => {
        if (!line) return;
        conn.send(encodeWsFrame(1, utf8Encode(line)));
      });
    },
    close() {
      fail();
    },
    onData(cb) {
      dataListeners.push(cb);
    },
    onClose(cb) {
      closeListeners.push(cb);
    },
  };
  return {
    link,
    pushText(text: string) {
      const line = text.endsWith('\n') ? text : `${text}\n`;
      dataListeners.forEach((cb) => cb(line));
    },
    fireClose() {
      if (closed) return;
      closed = true;
      closeListeners.forEach((cb) => cb());
    },
    setRest(next: Uint8Array) {
      rest = Uint8Array.from(next);
    },
    takeRest() {
      const current = rest;
      rest = new Uint8Array();
      return current;
    },
  };
}

const TCP_MISSING = 'Lokaler Mehrspieler braucht einen neuen Entwicklungs-Build mit react-native-tcp-socket.';

export function tcpByteListen(onConnection: (conn: ByteConn) => void, port: number): Promise<{ port: number; close(): void }> {
  let loaded: { default?: TcpApi; createServer?: TcpApi['createServer'] };
  try {
    loaded = require('react-native-tcp-socket');
  } catch {
    return Promise.reject(new Error(TCP_MISSING));
  }
  const api = loaded.default || loaded;
  if (!api || typeof api.createServer !== 'function') return Promise.reject(new Error(TCP_MISSING));
  const server = api.createServer((socket) => {
    onConnection(bindTcp(socket));
  });
  return new Promise((resolve, reject) => {
    server.on('error', (err) => reject(err instanceof Error ? err : new Error('Der Browser-Server ist nicht gestartet.')));
    server.listen({ port, host: '0.0.0.0' }, () => {
      const address = server.address();
      const chosen = address && typeof address.port === 'number' ? address.port : port;
      resolve({
        port: chosen,
        close() {
          try { server.close(); } catch { /* schon zu */ }
        },
      });
    });
  });
}

interface TcpApi {
  createServer: (listener: (socket: TcpSocket) => void) => TcpServer;
}

interface TcpServer {
  listen: (opts: { port: number; host: string }, cb: () => void) => void;
  address: () => { port?: number } | null;
  close: () => void;
  on: (event: string, cb: (err?: Error) => void) => void;
}

interface TcpSocket {
  write: (frame: string | Uint8Array) => void;
  destroy: () => void;
  on: (event: string, cb: (data?: unknown) => void) => void;
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff;
    return out;
  }
  return new Uint8Array();
}

function bindTcp(socket: TcpSocket): ByteConn {
  const dataListeners: ((chunk: Uint8Array) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeListeners.forEach((cb) => cb());
  };
  socket.on('data', (data) => {
    const bytes = toBytes(data);
    dataListeners.forEach((cb) => cb(bytes));
  });
  socket.on('error', () => fireClose());
  socket.on('close', () => fireClose());
  return {
    send(chunk) {
      if (closed) return;
      try {
        socket.write(typeof Buffer !== 'undefined' ? Buffer.from(chunk) : chunk);
      } catch {
        fireClose();
      }
    },
    close() {
      try { socket.destroy(); } catch { /* schon zu */ }
      fireClose();
    },
    onData(cb) {
      dataListeners.push(cb);
    },
    onClose(cb) {
      closeListeners.push(cb);
    },
  };
}
