/**
 * Gemeinsame Liste zuletzt gespielter Songs für alle OpenScrapps auf diesem Gerät.
 * Der Host setzt Quelle und Zeitpunkt. Aufrufer können sie nicht mitgeben.
 */
import { scrappMatchesTarget, normalizeScrappTarget } from './addons/manifest';

export const SONG_HISTORY_KEY = '@openscr_song_history';
export const SONG_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SONG_HISTORY_LIMIT = 200;
export const SONG_TEXT_MAX = 200;

export interface SongEntry {
  title: string;
  artist?: string;
  source: string;
  sourceName: string;
  playedAt: number;
}

export interface SongCaller {
  id: string;
  name: string;
  repoUrl: string;
}

export interface SongListQuery {
  source?: string;
  excludeSelf?: boolean;
  sinceMs?: number;
}

export interface SongHistoryStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

let storeOverride: SongHistoryStore | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

export function configureSongHistoryStore(store: SongHistoryStore | null): void {
  storeOverride = store;
  writeChain = Promise.resolve();
}

export function sanitizeSongText(value: string, max = SONG_TEXT_MAX): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/** Schlüssel für Dubletten: Titel, Künstler und Quelle, ohne Großschreibung und überzählige Leerzeichen. */
export function songDedupeKey(title: string, artist: string | undefined, source: string): string {
  const fold = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${fold(title)}\0${fold(artist || '')}\0${source}`;
}

export function pruneSongEntries(entries: readonly SongEntry[], now: number): SongEntry[] {
  const cutoff = now - SONG_WINDOW_MS;
  return entries
    .filter((entry) => Number.isFinite(entry.playedAt) && entry.playedAt >= cutoff)
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, SONG_HISTORY_LIMIT);
}

export function upsertSongEntry(entries: readonly SongEntry[], next: SongEntry, now: number): SongEntry[] {
  const key = songDedupeKey(next.title, next.artist, next.source);
  let found = false;
  const merged = entries.map((entry) => {
    if (songDedupeKey(entry.title, entry.artist, entry.source) !== key) return entry;
    found = true;
    return {
      ...entry,
      sourceName: next.sourceName,
      playedAt: now,
    };
  });
  if (!found) merged.push(next);
  return pruneSongEntries(merged, now);
}

export function songEntryMatchesSource(entry: SongEntry, filter: string, apps: readonly SongCaller[]): boolean {
  const want = normalizeScrappTarget(filter);
  if (!want) return false;
  if (normalizeScrappTarget(entry.source) === want || normalizeScrappTarget(entry.sourceName) === want) return true;
  const app = apps.find((item) => item.id === entry.source);
  return Boolean(app && scrappMatchesTarget(filter, app));
}

export function filterSongEntries(
  entries: readonly SongEntry[],
  callerId: string,
  query: SongListQuery,
  apps: readonly SongCaller[],
  now: number,
): SongEntry[] {
  const since = query.sinceMs == null ? now - SONG_WINDOW_MS : query.sinceMs;
  return pruneSongEntries(entries, now).filter((entry) => {
    if (entry.playedAt < since) return false;
    if (query.excludeSelf && entry.source === callerId) return false;
    if (query.source && !songEntryMatchesSource(entry, query.source, apps)) return false;
    return true;
  });
}

export function songSourceCounts(entries: readonly SongEntry[], now: number): { source: string; sourceName: string; count: number }[] {
  const fresh = pruneSongEntries(entries, now);
  const map = new Map<string, { source: string; sourceName: string; count: number; latest: number }>();
  for (const entry of fresh) {
    const row = map.get(entry.source);
    if (!row) {
      map.set(entry.source, { source: entry.source, sourceName: entry.sourceName, count: 1, latest: entry.playedAt });
    } else {
      row.count += 1;
      if (entry.playedAt >= row.latest) {
        row.latest = entry.playedAt;
        row.sourceName = entry.sourceName;
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.latest - a.latest)
    .map(({ source, sourceName, count }) => ({ source, sourceName, count }));
}

function parseEntries(raw: string | null): SongEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SongEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      if (typeof row.title !== 'string' || typeof row.source !== 'string' || typeof row.sourceName !== 'string') continue;
      if (typeof row.playedAt !== 'number') continue;
      const title = sanitizeSongText(row.title);
      if (!title) continue;
      const artist = typeof row.artist === 'string' ? sanitizeSongText(row.artist) : '';
      out.push({
        title,
        ...(artist ? { artist } : {}),
        source: row.source.slice(0, 200),
        sourceName: sanitizeSongText(row.sourceName, 120) || row.source.slice(0, 120),
        playedAt: row.playedAt,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function activeStore(): Promise<SongHistoryStore> {
  if (storeOverride) return storeOverride;
  const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
  };
  return {
    get: () => AsyncStorage.getItem(SONG_HISTORY_KEY),
    set: (value) => AsyncStorage.setItem(SONG_HISTORY_KEY, value),
  };
}

function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

async function readPruned(now: number): Promise<{ store: SongHistoryStore; entries: SongEntry[] }> {
  const store = await activeStore();
  const entries = pruneSongEntries(parseEntries(await store.get()), now);
  return { store, entries };
}

export async function addPlayedSong(
  caller: SongCaller,
  input: { title: string; artist?: string },
  now = Date.now(),
): Promise<{ ok: true }> {
  const title = sanitizeSongText(input.title);
  if (!title) throw new Error('Titel fehlt.');
  const artist = input.artist == null ? '' : sanitizeSongText(input.artist);
  const sourceName = sanitizeSongText(caller.name, 120) || caller.id;
  return locked(async () => {
    const { store, entries } = await readPruned(now);
    const next: SongEntry = {
      title,
      ...(artist ? { artist } : {}),
      source: caller.id,
      sourceName,
      playedAt: now,
    };
    await store.set(JSON.stringify(upsertSongEntry(entries, next, now)));
    return { ok: true as const };
  });
}

export async function listPlayedSongs(
  caller: SongCaller,
  query: SongListQuery,
  apps: readonly SongCaller[],
  now = Date.now(),
): Promise<SongEntry[]> {
  return locked(async () => {
    const { store, entries } = await readPruned(now);
    await store.set(JSON.stringify(entries));
    return filterSongEntries(entries, caller.id, query, apps, now);
  });
}

export async function listSongSources(
  now = Date.now(),
): Promise<{ source: string; sourceName: string; count: number }[]> {
  return locked(async () => {
    const { store, entries } = await readPruned(now);
    await store.set(JSON.stringify(entries));
    return songSourceCounts(entries, now);
  });
}

export async function clearPlayedSongs(callerId: string, now = Date.now()): Promise<{ ok: true }> {
  return locked(async () => {
    const { store, entries } = await readPruned(now);
    const kept = entries.filter((entry) => entry.source !== callerId);
    await store.set(JSON.stringify(kept));
    return { ok: true as const };
  });
}
