/**
 * One player list for every OpenScrapp on this device.
 * A name is a display name plus a tag, like a League of Legends Riot ID.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notifyRoster } from './rosterSync';

const KEY = '@openscr_players_v1';
const NAME = /^(?=[\p{L}\p{N}].{1,14}[\p{L}\p{N}]$)(?:[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*)$/u;
const TAG = /^[\p{L}\p{N}]{3,5}$/u;

export interface PlayerRecord {
  id: string;
  name: string;
  tag: string;
  /** All-time stats from players.setStats. The dev roster uses sample figures. */
  werwolf?: {
    games: number;
    wins: number;
    deaths: number;
    roles: Record<string, { games: number; wins: number; deaths: number }>;
  };
  songraten?: {
    games: number;
    wins: number;
    points: number;
    djSongs: number;
    guessed: number;
  };
}

export function playerKey(name: string, tag: string): string {
  return `${name.toLocaleLowerCase()}#${tag.toLocaleLowerCase()}`;
}

export function formatPlayer(player: Pick<PlayerRecord, 'name' | 'tag'>): string {
  return `${player.name} #${player.tag}`;
}

export function checkPlayerParts(name: unknown, tag: unknown): { name: string; tag: string } {
  const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim();
  const cleanTag = String(tag ?? '').trim();
  if (!NAME.test(cleanName)) {
    throw new Error('Der Anzeigename braucht 3 bis 16 Zeichen aus Buchstaben und Zahlen. Leerzeichen nur zwischen Wörtern.');
  }
  if (!TAG.test(cleanTag)) {
    throw new Error('Der Tag hinter # braucht 3 bis 5 Buchstaben oder Zahlen.');
  }
  return { name: cleanName, tag: cleanTag };
}

function newId(): string {
  const bytes = new Uint8Array(8);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readAll(): Promise<PlayerRecord[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PlayerRecord[];
    return Array.isArray(parsed) ? parsed.filter((row) => row && row.id && row.name && row.tag) : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: PlayerRecord[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(rows));
}

export type StatsAppId = 'werwolf' | 'songraten';

const MAX_STAT = 1_000_000;
const MAX_ROLES = 40;
const MAX_RECORDS = 100;
const MAX_ROLE_KEY = 40;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const FIELD_ALIASES: Record<string, string[]> = {
  games: ['games', 'g', 'got'],
  wins: ['wins', 'w', 'won'],
  deaths: ['deaths', 'd'],
  points: ['points'],
  djSongs: ['djSongs', 'dj'],
  guessed: ['guessed', 'hit'],
};

export function statsAppFromProfile(profile?: { name?: string; repoUrl?: string } | null): StatsAppId | null {
  const hay = `${profile?.repoUrl || ''} ${profile?.name || ''}`.toLowerCase();
  if (hay.includes('werwolf')) return 'werwolf';
  if (/(guessthesong|guess-the-song|songraten|song raten|song-raten)/.test(hay)) return 'songraten';
  return null;
}

function cleanCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_STAT, Math.floor(n));
}

function pickCount(raw: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    if (raw[name] != null) return cleanCount(raw[name]);
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanRoleKey(key: string): string | null {
  const clean = key.trim().toLowerCase();
  if (!clean || clean.length > MAX_ROLE_KEY || FORBIDDEN_KEYS.has(clean)) return null;
  if (!/^[\p{L}\p{N}_-]+$/u.test(clean)) return null;
  return clean;
}

function cleanRoleSlice(raw: unknown): { games: number; wins: number; deaths: number } | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  return {
    games: pickCount(rec, FIELD_ALIASES.games),
    wins: pickCount(rec, FIELD_ALIASES.wins),
    deaths: pickCount(rec, FIELD_ALIASES.deaths),
  };
}

export function cleanWerwolfStats(input: Record<string, unknown>): NonNullable<PlayerRecord['werwolf']> {
  const roles: Record<string, { games: number; wins: number; deaths: number }> = {};
  const rolesRaw = asRecord(input.roles);
  if (rolesRaw) {
    for (const key of Object.keys(rolesRaw).slice(0, MAX_ROLES)) {
      const name = cleanRoleKey(key);
      const slice = cleanRoleSlice(rolesRaw[key]);
      if (name && slice) roles[name] = slice;
    }
  }
  return {
    games: pickCount(input, FIELD_ALIASES.games),
    wins: pickCount(input, FIELD_ALIASES.wins),
    deaths: pickCount(input, FIELD_ALIASES.deaths),
    roles,
  };
}

export function cleanSongratenStats(input: Record<string, unknown>): NonNullable<PlayerRecord['songraten']> {
  return {
    games: pickCount(input, FIELD_ALIASES.games),
    wins: pickCount(input, FIELD_ALIASES.wins),
    points: pickCount(input, FIELD_ALIASES.points),
    djSongs: pickCount(input, FIELD_ALIASES.djSongs),
    guessed: pickCount(input, FIELD_ALIASES.guessed),
  };
}

export function parseStatsRecords(input: unknown): Record<string, unknown>[] {
  const rec = asRecord(input);
  if (!rec) throw new Error('Die Statistik muss ein Objekt sein.');
  const rows = Array.isArray(rec.records) ? rec.records : rec.id != null ? [rec] : null;
  if (!rows) throw new Error('Es fehlt die Spieler-ID oder records.');
  if (rows.length > MAX_RECORDS) throw new Error('Höchstens 100 Statistik-Einträge.');
  return rows.map((row) => {
    const item = asRecord(row);
    if (!item) throw new Error('Jeder Statistik-Eintrag muss ein Objekt sein.');
    const id = String(item.id ?? '').trim();
    if (!id || id.length > 40) throw new Error('Ungültige Spieler-ID.');
    return { ...item, id };
  });
}

export function readStat(
  row: PlayerRecord,
  app: StatsAppId,
  field: 'games' | 'wins' | 'deaths' | 'points' | 'djSongs' | 'guessed',
  role?: string | null,
): number {
  const block = row[app];
  if (!block) return 0;
  const source = role && app === 'werwolf'
    ? (block as NonNullable<PlayerRecord['werwolf']>).roles?.[role]
    : block;
  const rec = asRecord(source);
  if (!rec) return 0;
  return pickCount(rec, FIELD_ALIASES[field] || [field]);
}

export function applyPlayerStats(
  rows: PlayerRecord[],
  app: StatsAppId,
  records: Record<string, unknown>[],
): { rows: PlayerRecord[]; updated: number } {
  const indexById = new Map(rows.map((row, index) => [row.id, index]));
  const next = rows.slice();
  let updated = 0;
  for (const record of records) {
    const index = indexById.get(String(record.id ?? ''));
    if (index == null) continue;
    const current = next[index];
    next[index] = app === 'werwolf'
      ? { ...current, werwolf: cleanWerwolfStats(record) }
      : { ...current, songraten: cleanSongratenStats(record) };
    updated += 1;
  }
  return { rows: next, updated };
}

/** Merge one OpenScrapp's stats into existing players. Unknown IDs are skipped. Other apps stay untouched. */
export async function setPlayerStats(app: StatsAppId, input: unknown): Promise<{ ok: true; updated: number }> {
  const records = parseStatsRecords(input);
  const applied = applyPlayerStats(await readAll(), app, records);
  if (applied.updated > 0) await writeAll(applied.rows);
  return { ok: true, updated: applied.updated };
}

const DEV_NAMES: [string, string][] = [
  ['Mina Wolf', '7K2'],
  ['Leo Sommer', 'A1B'],
  ['Noah Berg', 'X9Q'],
  ['Emma Stahl', '4RT'],
  ['Paul Krug', 'M3N'],
  ['Lina Feld', 'K8P'],
  ['Juna Hart', '2WQ'],
  ['Mats Holm', 'B5C'],
  ['Theo Ried', 'H7D'],
  ['Mira Lund', 'Q1Z'],
  ['Finn Adler', '9LM'],
  ['Nela Voss', 'C4K'],
  ['Ole Brandt', 'T6Y'],
  ['Ida Kern', 'P2S'],
  ['Lars Moos', 'W8F'],
  ['Anja Feld', '3HN'],
  ['Kurt Holm', 'R5A'],
  ['Svea Lind', '6JD'],
  ['Ben Vogel', 'N0E'],
  ['Pia Sturm', 'U4G'],
];

function sampleWerwolf(index: number): NonNullable<PlayerRecord['werwolf']> {
  const games = 6 + ((index * 5) % 17);
  const wins = 1 + ((index * 3) % Math.max(1, games - 1));
  const wolfGames = 1 + (index % 6);
  const wolfWins = Math.min(wins, wolfGames, 1 + (index % 3));
  const wolfDeaths = Math.max(0, wolfGames - wolfWins);
  const villageGames = games - wolfGames;
  const villageWins = Math.max(0, wins - wolfWins);
  return {
    games,
    wins,
    deaths: Math.max(0, games - wins - (index % 3)),
    roles: {
      werwolf: { games: wolfGames, wins: wolfWins, deaths: wolfDeaths },
      dorfbewohner: { games: villageGames, wins: villageWins, deaths: Math.max(0, villageGames - villageWins) },
    },
  };
}

function sampleSongraten(index: number): NonNullable<PlayerRecord['songraten']> {
  const games = 5 + ((index * 4) % 14);
  const wins = index % Math.max(1, games - 2);
  return {
    games,
    wins,
    points: 12 + index * 7 + (index % 4) * 3,
    djSongs: 3 + (index % 9),
    guessed: 2 + ((index * 2) % 11),
  };
}

const DEV_PLAYERS: PlayerRecord[] = DEV_NAMES.map(([name, tag], index) => ({
  id: `dev${String(index + 1).padStart(2, '0')}`,
  name,
  tag,
  werwolf: sampleWerwolf(index),
  songraten: sampleSongraten(index),
}));

async function readRoster(): Promise<PlayerRecord[]> {
  const rows = await readAll();
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  const staleSeed = rows.length === DEV_PLAYERS.length
    && rows.every((row) => row.id.startsWith('dev') && (!row.werwolf || !row.songraten || row.werwolf.roles.werwolf?.deaths == null));
  if (!dev || (rows.length > 0 && !staleSeed)) return rows;
  await writeAll(DEV_PLAYERS);
  return DEV_PLAYERS;
}

export async function listPlayers(): Promise<PlayerRecord[]> {
  console.log('[openscr] players.list');
  const rows = await readRoster();
  console.log('[openscr] players.list fertig', rows.length);
  return rows.sort((a, b) => formatPlayer(a).localeCompare(formatPlayer(b), 'de'));
}

export async function addPlayer(name: unknown, tag: unknown): Promise<PlayerRecord> {
  const parts = checkPlayerParts(name, tag);
  const rows = await readAll();
  const key = playerKey(parts.name, parts.tag);
  if (rows.some((row) => playerKey(row.name, row.tag) === key)) {
    throw new Error('Diesen Namen gibt es schon. Anzeigename und Tag gelten ohne Großschreibung.');
  }
  if (rows.length >= 100) throw new Error('Höchstens 100 Spielernamen.');
  const row = { id: newId(), ...parts };
  rows.push(row);
  await writeAll(rows);
  notifyRoster();
  return row;
}

export async function updatePlayer(id: unknown, name: unknown, tag: unknown): Promise<PlayerRecord> {
  const playerId = String(id ?? '');
  const parts = checkPlayerParts(name, tag);
  const rows = await readAll();
  const index = rows.findIndex((row) => row.id === playerId);
  if (index < 0) throw new Error('Diesen Spieler gibt es nicht.');
  const key = playerKey(parts.name, parts.tag);
  if (rows.some((row, at) => at !== index && playerKey(row.name, row.tag) === key)) {
    throw new Error('Diesen Namen gibt es schon. Anzeigename und Tag gelten ohne Großschreibung.');
  }
  rows[index] = { ...rows[index], id: playerId, name: parts.name, tag: parts.tag };
  await writeAll(rows);
  notifyRoster();
  return rows[index];
}

export async function removePlayer(id: unknown): Promise<void> {
  const playerId = String(id ?? '');
  const rows = await readAll();
  await writeAll(rows.filter((row) => row.id !== playerId));
  notifyRoster();
}
