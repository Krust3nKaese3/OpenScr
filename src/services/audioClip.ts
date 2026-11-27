/**
 * Schneidet PCM auf 16 kHz mono mu-law. 10 Sekunden ergeben 160012 Bytes (12 Byte Kopf + 160000).
 * Kopfformat: "MULW", Abtastrate uint32 LE, Dauer uint32 LE, dann mu-law.
 */
export const CLIP_HEADER = 12;
export const CLIP_RATE = 16000;
export const MULAW_SILENCE = 0xff;

export function buildClip(
  channel: ArrayLike<number>,
  sampleRate: number,
  startMs: number,
  durationMs: number,
  targetBytes?: number,
): Uint8Array {
  const CLIP_HEADER = 12;
  const CLIP_RATE = 16000;
  const MULAW_SILENCE = 0xff;
  function linearToMulaw(sample: number): number {
    const BIAS = 132;
    const CLIP = 32635;
    let sign = 0;
    let magnitude = sample < 0 ? -sample : sample;
    if (sample < 0) sign = 0x80;
    if (magnitude > CLIP) magnitude = CLIP;
    magnitude += BIAS;
    let exponent = 7;
    let mask = 0x4000;
    while (exponent > 0 && (magnitude & mask) === 0) {
      exponent -= 1;
      mask >>= 1;
    }
    const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
    return (~(sign | (exponent << 4) | mantissa)) & 0xff;
  }
  function writeU32(bytes: Uint8Array, offset: number, value: number): void {
    const n = value >>> 0;
    bytes[offset] = n & 0xff;
    bytes[offset + 1] = (n >> 8) & 0xff;
    bytes[offset + 2] = (n >> 16) & 0xff;
    bytes[offset + 3] = (n >> 24) & 0xff;
  }
  const rate = sampleRate > 0 ? sampleRate : CLIP_RATE;
  const duration = Math.max(0, Math.min(120_000, Math.round(durationMs)));
  const start = Math.max(0, Math.floor((startMs / 1000) * rate));
  const countIn = Math.max(0, Math.floor((duration / 1000) * rate));
  const outCount = Math.round((duration / 1000) * CLIP_RATE);
  const mulaw = new Uint8Array(outCount);
  for (let i = 0; i < outCount; i++) {
    let sample = 0;
    if (countIn > 0 && channel.length > 0) {
      const src = start + Math.min(countIn - 1, Math.floor((i * rate) / CLIP_RATE));
      const raw = src >= 0 && src < channel.length ? channel[src] : 0;
      const clamped = raw < -1 ? -1 : raw > 1 ? 1 : raw;
      sample = Math.round(clamped * 32767);
    }
    mulaw[i] = linearToMulaw(sample);
  }
  const packet = new Uint8Array(CLIP_HEADER + mulaw.length);
  packet[0] = 0x4d;
  packet[1] = 0x55;
  packet[2] = 0x4c;
  packet[3] = 0x57;
  writeU32(packet, 4, CLIP_RATE);
  writeU32(packet, 8, duration);
  packet.set(mulaw, CLIP_HEADER);
  if (typeof targetBytes === 'number' && targetBytes > packet.length && targetBytes <= 512 * 1024) {
    const padded = new Uint8Array(targetBytes);
    padded.set(packet);
    padded.fill(MULAW_SILENCE, packet.length);
    return padded;
  }
  return packet;
}
