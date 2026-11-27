/**
 * Registers the open scrapp with the dev guest server and relays guest
 * WebSocket text back into the host room.
 */
import { devFolderFor } from '../devFolder';
import { GUEST_SHIM_SOURCE, guestBootTags, injectGuestDocument } from './guestHttp';
import type { GuestContent } from './guestContent';
import type { GuestServer } from './guestServer';
import type { MpLink } from './transport';

const DEV_PORT = 8791;

export function devGuestOrigin(): string {
  if (typeof document !== 'undefined') return `http://127.0.0.1:${DEV_PORT}`;
  try {
    const Constants = require('expo-constants').default;
    const hostUri = Constants?.expoGoConfig?.debuggerHost
      || Constants?.expoConfig?.hostUri
      || Constants?.manifest?.debuggerHost
      || '';
    const host = String(hostUri).split(':')[0];
    if (host) return `http://${host}:${DEV_PORT}`;
  } catch {
    /* Ohne Metro bleibt der Server auf dem Handy. */
  }
  return '';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface LiveLink extends MpLink {
  push(text: string): void;
}

export async function openBrowserDevGuest(opts: {
  token: string;
  appId: string;
  room: string;
  content: GuestContent;
  onLink: (link: MpLink) => void;
  origin?: string;
}): Promise<GuestServer & { ip: string }> {
  const DEV = opts.origin || devGuestOrigin() || `http://127.0.0.1:${DEV_PORT}`;
  const listed = opts.content.list ? await opts.content.list() : [];
  const paths = listed.includes(opts.content.entry) ? listed : [opts.content.entry, ...listed];
  const files: { path: string; mime: string; base64: string }[] = [];
  for (const rel of paths) {
    const file = await opts.content.read(rel);
    if (!file) continue;
    const isEntry = rel === opts.content.entry;
    const body = isEntry
      ? new TextEncoder().encode(injectGuestDocument(new TextDecoder().decode(file.body), opts.token, opts.appId, opts.room))
      : file.body;
    files.push({
      path: isEntry ? '' : rel,
      mime: isEntry ? 'text/html; charset=utf-8' : file.mime,
      base64: bytesToBase64(body),
    });
  }
  files.push({
    path: 'openscr-guest.js',
    mime: 'text/javascript; charset=utf-8',
    base64: bytesToBase64(new TextEncoder().encode(GUEST_SHIM_SOURCE)),
  });
  const response = await fetch(`${DEV}/openscr-dev-guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: opts.token,
      appId: opts.appId,
      room: opts.room,
      root: devFolderFor(opts.appId),
      boot: guestBootTags(opts.token, opts.appId, opts.room),
      files,
    }),
  });
  if (!response.ok) throw new Error((await response.text()) || 'Der Gastserver im Browser ist nicht gestartet.');
  const info = await response.json() as { port: number; ip: string };
  const origin = new URL(DEV);
  const hostSocket = new WebSocket(`${origin.protocol === 'https:' ? 'wss:' : 'ws:'}//${origin.host}/openscr-dev-host?token=${opts.token}`);
  const links = new Map<string, LiveLink>();
  const waiting = new Map<string, string[]>();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Der Gastserver im Browser antwortet nicht.')), 4000);
    hostSocket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    hostSocket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Der Gastserver im Browser ist nicht erreichbar. Metro neu starten.'));
    };
  });
  hostSocket.onmessage = (event) => {
    let message: { t?: string; id?: string; data?: string };
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const id = message.id || '';
    if (!id) return;
    if (message.t === 'guest') {
      const dataListeners: ((chunk: string) => void)[] = [];
      const closeListeners: (() => void)[] = [];
      let closed = false;
      const link: LiveLink = {
        browser: true,
        send(frame) {
          if (!closed && hostSocket.readyState === WebSocket.OPEN) {
            hostSocket.send(JSON.stringify({ t: 'text', id, data: frame }));
          }
        },
        close() {
          if (closed) return;
          closed = true;
          if (hostSocket.readyState === WebSocket.OPEN) hostSocket.send(JSON.stringify({ t: 'close', id }));
          closeListeners.forEach((cb) => cb());
        },
        onData(cb) { dataListeners.push(cb); },
        onClose(cb) { closeListeners.push(cb); },
        push(text) { dataListeners.forEach((cb) => cb(text)); },
      };
      links.set(id, link);
      opts.onLink(link);
      (waiting.get(id) || []).forEach((line) => link.push(line));
      waiting.delete(id);
      return;
    }
    const link = links.get(id);
    if (message.t === 'text' && typeof message.data === 'string') {
      const line = message.data.endsWith('\n') ? message.data : `${message.data}\n`;
      if (link) link.push(line);
      else waiting.set(id, [...(waiting.get(id) || []), line]);
    }
    if (message.t === 'close') link?.close();
  };
  console.log('[openscr-mp] Gastserver im Browser', `http://${info.ip}:${info.port}/g/${opts.token}/`);
  return {
    port: info.port,
    ip: info.ip,
    url(ip: string) {
      return `http://${ip}:${info.port}/g/${opts.token}/`;
    },
    close() {
      links.forEach((link) => link.close());
      hostSocket.close();
      links.clear();
    },
  };
}
