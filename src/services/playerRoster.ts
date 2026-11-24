/**
 * One player list for every OpenScrapp on this device.
 * A name is a display name plus a tag, like a League of Legends Riot ID.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@openscr_players_v1';
const NAME = /^(?=[\p{L}\p{N}].{1,14}[\p{L}\p{N}]$)(?:[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*)$/u;
const TAG = /^[\p{L}\p{N}]{3,5}$/u;

export interface PlayerRecord {
  id: string;
  name: string;
  tag: string;
  /** Sample figures for the dev roster. Real games keep their own history. */
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
  return `${player.name}#${player.tag}`;
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
  return rows[index];
}

export async function removePlayer(id: unknown): Promise<void> {
  const playerId = String(id ?? '');
  const rows = await readAll();
  await writeAll(rows.filter((row) => row.id !== playerId));
}
