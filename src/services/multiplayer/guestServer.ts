/**
 * Kleiner HTTP- und WebSocket-Server auf einem Byte-Socket.
 * In der App ist das react-native-tcp-socket. Tests benutzen einen Ersatz.
 */
import type { MpLink } from './transport';
import { mimeForPath } from '../miniAppFiles';
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
  /** Fertig, wenn alle bisherigen Bytes wirklich raus sind. Android schreibt asynchron. */
  drain?(): Promise<void>;
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
const guestNotes: string[] = [];

function noteGuest(message: string): void {
  const line = `[openscr-guest] ${message}`;
  console.warn(line);
  guestNotes.push(message);
  if (guestNotes.length > 6) guestNotes.shift();
}

export function guestErrorNotes(): string[] {
  return guestNotes.slice();
}

export async function openGuestServer(opts: {
  token: string;
  appId: string;
  room: string;
  preferredPort?: number;
  listen: ByteListen;
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
  opts: { token: string; appId: string; room: string; read: (rel: string) => Promise<GuestFile | null>; onLink: (link: MpLink) => void },
  done: () => void,
): void {
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let mode: 'http' | 'file' | 'ws' | 'dead' = 'http';
  let link: ReturnType<typeof createBrowserLink> | null = null;
  const fail = () => {
    if (mode === 'dead') return;
    mode = 'dead';
    link?.fireClose();
    const flushed = conn.drain ? conn.drain() : Promise.resolve();
    void flushed.finally(() => {
      conn.close();
      done();
    });
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
      if (head.method !== 'GET' && head.method !== 'HEAD') {
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
      void serveFile(opts, target.rel, head.headers.range, head.method === 'HEAD').then((bytes) => {
        conn.send(bytes);
        fail();
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Datei nicht lesbar.';
        noteGuest(`GET ${target.rel || '/'} fehlgeschlagen: ${message}`);
        conn.send(textResponse(500, message));
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
  opts: { token: string; appId: string; room: string; read: (rel: string) => Promise<GuestFile | null> },
  rel: string,
  range?: string,
  headOnly = false,
): Promise<Uint8Array> {
  if (rel === 'openscr-guest.js' || rel.endsWith('/openscr-guest.js')) {
    return fileBytes('text/javascript; charset=utf-8', utf8Encode(GUEST_SHIM_SOURCE), range, headOnly);
  }
  const file = await opts.read(rel);
  if (!file) {
    if (rel) return textResponse(404, `Nicht gefunden: ${rel}`);
    const html = injectGuestDocument('<p>Die OpenScrapp ist noch nicht geladen.</p>', opts.token, opts.appId, opts.room);
    return fileBytes('text/html; charset=utf-8', utf8Encode(html), range, headOnly);
  }
  if (file.body.length > MAX_FILE) return textResponse(413, 'Datei zu groß.');
  const fromPath = rel ? mimeForPath(rel) : '';
  const mime = (fromPath && fromPath !== 'application/octet-stream' ? fromPath : file.mime) || 'application/octet-stream';
  let html = mime.startsWith('text/html') ? utf8Slice(file.body.slice()) : '';
  if (html && guestNotes.length) {
    const note = guestNotes.map((line) => line.replace(/[<>&]/g, '')).join('\n');
    html = html.replace(/<head[^>]*>/i, (match) => `${match}<script>console.warn(${JSON.stringify(note)});</script>`);
  }
  const payload = mime.startsWith('text/html')
    ? utf8Encode(injectGuestDocument(html, opts.token, opts.appId, opts.room))
    : file.body.slice();
  const type = mime.startsWith('text/') || mime.includes('javascript') || mime.includes('json') ? `${mime}; charset=utf-8` : mime;
  return fileBytes(type, payload, range, headOnly);
}

/** Chrome lädt Audio mit `Range: bytes=0-` und erwartet 206. */
function fileBytes(type: string, payload: Uint8Array, range: string | undefined, headOnly: boolean): Uint8Array {
  const headers: Record<string, string> = { 'content-type': type, 'accept-ranges': 'bytes' };
  const sized = payload.length;
  const part = byteRange(payload, range);
  if (part.unsatisfiable) {
    return httpBytes(416, 'Range Not Satisfiable', { ...headers, 'content-range': `bytes */${sized}` }, new Uint8Array());
  }
  if (part.partial) headers['content-range'] = `bytes ${part.start}-${part.end}/${sized}`;
  const body = headOnly ? new Uint8Array() : part.body;
  if (headOnly) headers['content-length'] = String(part.body.length);
  return httpBytes(part.partial ? 206 : 200, part.partial ? 'Partial Content' : 'OK', headers, body);
}

function byteRange(payload: Uint8Array, range: string | undefined): { body: Uint8Array; partial: boolean; unsatisfiable: boolean; start: number; end: number } {
  const size = payload.length;
  const full = { body: payload, partial: false, unsatisfiable: false, start: 0, end: Math.max(0, size - 1) };
  if (!range) return full;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || (match[1] === '' && match[2] === '')) return full;
  let start = 0;
  let end = size - 1;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { ...full, unsatisfiable: true };
    start = Math.max(0, size - suffix);
  } else {
    start = Number(match[1]);
    if (match[2] !== '') end = Number(match[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return { ...full, unsatisfiable: true };
  }
  end = Math.min(end, size - 1);
  return { body: payload.slice(start, end + 1), partial: true, unsatisfiable: false, start, end };
}

/** Prüft vom Handy aus, dass diese Instanz die Seite und die Brücke wirklich sendet. */
export async function assertGuestServing(port: number, token: string): Promise<void> {
  let last = 'keine Antwort';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const page = await localGet(port, `/g/${token}/`);
      const shim = await localGet(port, `/g/${token}/openscr-guest.js`);
      if (!page.startsWith('HTTP/1.1 200') && !page.startsWith('HTTP/1.0 200')) {
        throw new Error(page.slice(0, 80) || 'leere Antwort');
      }
      if (!page.includes('openscr-guest.js')) throw new Error('Die Gastseite enthält die Brücke nicht.');
      if (!shim.includes('200') || !shim.includes('OpenScrBridge')) throw new Error('openscr-guest.js kommt nicht an.');
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : 'keine Antwort';
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(last);
}

function localGet(port: number, path: string): Promise<string> {
  const loaded = require('react-native-tcp-socket') as { createConnection?: Function; default?: { createConnection?: Function } };
  const create = loaded.createConnection || loaded.default?.createConnection;
  if (!create) return Promise.reject(new Error(TCP_MISSING));
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(chunks.map((part) => utf8Slice(part)).join(''));
    };
    const socket = create({ port, host: '127.0.0.1', connectTimeout: 3000 }, () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    }) as TcpSocket;
    const timer = setTimeout(() => finish(new Error('Der Gastserver antwortet nicht.')), 3000);
    socket.on('data', (data) => chunks.push(toBytes(data)));
    socket.on('error', (err) => {
      clearTimeout(timer);
      finish(err instanceof Error ? err : new Error('Der Gastserver antwortet nicht.'));
    });
    socket.on('close', () => {
      clearTimeout(timer);
      finish(chunks.length ? undefined : new Error('Der Gastserver hat keine Daten gesendet.'));
    });
  });
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
  let server: TcpServer;
  try {
    server = api.createServer((socket) => {
      onConnection(bindTcp(socket));
    });
  } catch (error) {
    if (typeof document === 'undefined') return Promise.reject(error instanceof Error ? error : new Error(TCP_MISSING));
    return Promise.resolve({ port: port || 8099, close() {} });
  }
  if (!server || typeof server.listen !== 'function') {
    if (typeof document === 'undefined') return Promise.reject(new Error(TCP_MISSING));
    return Promise.resolve({ port: port || 8099, close() {} });
  }
  return new Promise((resolve, reject) => {
    try {
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
    } catch (error) {
      if (typeof document === 'undefined') reject(error instanceof Error ? error : new Error(TCP_MISSING));
      else resolve({ port: port || 8099, close() {} });
    }
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
  write: (frame: string | Uint8Array, encoding?: string, cb?: (err?: Error) => void) => void;
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
  let tail = Promise.resolve();
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeListeners.forEach((cb) => cb());
  };
  socket.on('data', (data) => {
    const bytes = toBytes(data);
    dataListeners.forEach((cb) => cb(bytes));
  });
  socket.on('error', (err) => {
    noteGuest(err instanceof Error ? err.message : 'Socketfehler');
    fireClose();
  });
  socket.on('close', () => fireClose());
  return {
    send(chunk) {
      const body = chunk.slice();
      tail = tail.then(() => new Promise<void>((resolve) => {
        if (closed) {
          resolve();
          return;
        }
        try {
          const buf = typeof Buffer !== 'undefined' ? Buffer.from(body) : body;
          socket.write(buf, undefined, () => resolve());
        } catch (error) {
          noteGuest(error instanceof Error ? error.message : 'Senden fehlgeschlagen');
          resolve();
        }
      }));
    },
    drain() {
      return tail;
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
