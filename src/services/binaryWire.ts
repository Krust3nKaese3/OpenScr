/**
 * Binärstücke für den Mehrspieler-Raum. Jedes Stück bleibt unter dem JSON-Rahmen.
 * Die Teile werden einzeln dekodiert und wieder aneinandergehängt.
 */
export const BINARY_LIMITS = {
  maxBytes: 256 * 1024,
  chunkRaw: 12_000,
  maxChunks: 32,
};

export interface BinaryChunk {
  i: number;
  n: number;
  b: string;
}

export interface BinarySlot {
  n: number;
  parts: (Uint8Array | undefined)[];
  got: number;
  bytes: number;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('Binärdaten sind kein Base64.');
  }
  const clean = value.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = ALPHABET.indexOf(clean[i]);
    const b = ALPHABET.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? ALPHABET.indexOf(clean[i + 2]) : 0;
    const d = i + 3 < clean.length ? ALPHABET.indexOf(clean[i + 3]) : 0;
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Binärdaten sind kein Base64.');
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[p++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[p++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[p++] = n & 255;
  }
  return out;
}

export function base64ByteLength(value: string): number {
  return base64ToBytes(value).length;
}

export function splitBytes(bytes: Uint8Array, chunkRaw = BINARY_LIMITS.chunkRaw): BinaryChunk[] {
  if (bytes.length > BINARY_LIMITS.maxBytes) {
    throw new Error('Binärdaten sind zu groß (höchstens 256 KiB).');
  }
  if (bytes.length === 0) throw new Error('Binärdaten sind leer.');
  const n = Math.ceil(bytes.length / chunkRaw);
  if (n > BINARY_LIMITS.maxChunks) throw new Error('Binärdaten sind zu groß (höchstens 256 KiB).');
  const chunks: BinaryChunk[] = [];
  for (let i = 0; i < n; i++) {
    const slice = bytes.subarray(i * chunkRaw, Math.min(bytes.length, (i + 1) * chunkRaw));
    chunks.push({ i, n, b: bytesToBase64(slice) });
  }
  return chunks;
}

export function pushBinaryChunk(slot: BinarySlot | undefined, chunk: BinaryChunk): { slot: BinarySlot; done?: Uint8Array; received: number; total: number } {
  if (!Number.isInteger(chunk.i) || !Number.isInteger(chunk.n) || chunk.n < 1 || chunk.n > BINARY_LIMITS.maxChunks || chunk.i < 0 || chunk.i >= chunk.n) {
    throw new Error('Binärstück ist ungültig.');
  }
  const next = slot && slot.n === chunk.n ? slot : { n: chunk.n, parts: new Array(chunk.n), got: 0, bytes: 0 };
  if (!next.parts[chunk.i]) {
    const bytes = base64ToBytes(chunk.b);
    if (next.bytes + bytes.length > BINARY_LIMITS.maxBytes) throw new Error('Binärdaten sind zu groß (höchstens 256 KiB).');
    next.parts[chunk.i] = bytes;
    next.got += 1;
    next.bytes += bytes.length;
  }
  if (next.got < next.n) return { slot: next, received: next.got, total: next.n };
  const size = next.parts.reduce((sum, part) => sum + (part ? part.length : 0), 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of next.parts) {
    if (!part) throw new Error('Binärstück fehlt.');
    out.set(part, offset);
    offset += part.length;
  }
  return { slot: next, done: out, received: next.got, total: next.n };
}
