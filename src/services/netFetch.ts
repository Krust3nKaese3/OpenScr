/**
 * HTTP ohne CORS, auf der React-Native-Seite. Antwort als Text, Base64 oder Base64-Stücke.
 */
import { bytesToBase64 } from './binaryWire';

export const NET_FETCH_LIMITS = {
  maxResponseBytes: 1_500_000,
  chunkRaw: 48 * 1024,
  defaultTimeoutMs: 20_000,
  maxTimeoutMs: 60_000,
};

export interface NetFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  timeoutMs?: number;
  binary?: boolean;
  chunked?: boolean;
}

export interface NetFetchResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  encoding: 'text' | 'base64' | 'base64-chunks';
  body?: string;
  chunks?: string[];
  byteLength: number;
}

export async function performNetFetch(url: string, options: NetFetchOptions | undefined, fetchImpl: typeof fetch = fetch): Promise<NetFetchResult> {
  const opt = options || {};
  const timeoutMs = opt.timeoutMs && opt.timeoutMs > 0 ? Math.min(opt.timeoutMs, NET_FETCH_LIMITS.maxTimeoutMs) : NET_FETCH_LIMITS.defaultTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = opt.bodyBase64 ? bytesFromBase64(opt.bodyBase64) : opt.body;
    const response = await fetchImpl(url, {
      method: opt.method || 'GET',
      headers: opt.headers,
      body: body as BodyInit | undefined,
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > NET_FETCH_LIMITS.maxResponseBytes) {
      throw new Error('Antwort ist zu groß (höchstens 1,5 MiB).');
    }
    if (opt.chunked) {
      const chunks: string[] = [];
      for (let i = 0; i < buffer.length; i += NET_FETCH_LIMITS.chunkRaw) {
        chunks.push(bytesToBase64(buffer.subarray(i, Math.min(buffer.length, i + NET_FETCH_LIMITS.chunkRaw))));
      }
      return { ok: response.ok, status: response.status, headers, encoding: 'base64-chunks', chunks, byteLength: buffer.length };
    }
    if (opt.binary) {
      return { ok: response.ok, status: response.status, headers, encoding: 'base64', body: bytesToBase64(buffer), byteLength: buffer.length };
    }
    return { ok: response.ok, status: response.status, headers, encoding: 'text', body: new TextDecoder().decode(buffer), byteLength: buffer.length };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Antwort ist zu groß')) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Zeitlimit der Anfrage ist abgelaufen.');
    throw new Error(error instanceof Error ? error.message : 'HTTP-Anfrage fehlgeschlagen.');
  } finally {
    clearTimeout(timer);
  }
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = globalThis.atob ? globalThis.atob(value) : Buffer.from(value, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 255;
  return out;
}
