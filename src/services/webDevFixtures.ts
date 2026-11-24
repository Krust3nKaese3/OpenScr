/** Fixed Spotify and Bluetooth answers for the browser dev shell. Phones never read this. */

export type WebDevListener = (event: string, data: unknown) => void;

export interface FixtureTrack {
  uri: string;
  name: string;
  artist: string;
  artists: string[];
  album: string;
  durationMs: number;
}

const TRACKS: FixtureTrack[] = [
  ['Gelbes U-Boot', 180000],
  ['Zweiter Song', 210000],
  ['Dritter Song', 195000],
  ['Mitternachtstaxi', 204000],
  ['Rote Laterne', 176000],
  ['Sommerregen', 221000],
  ['Letzte Bahn', 198000],
  ['Kupferdraht', 187000],
  ['Fenster auf', 203000],
  ['Kleine Stadt', 214000],
  ['Nachtmarkt', 192000],
  ['Papierboot', 168000],
  ['Alte Jacke', 231000],
  ['Grünes Licht', 189000],
  ['Kalter Kaffee', 205000],
  ['Dachterrasse', 217000],
  ['Leiser Donner', 242000],
  ['Straßenlaterne', 176000],
  ['Offenes Fenster', 199000],
  ['Kurze Nachricht', 163000],
  ['Blaue Stunde', 228000],
  ['Holztreppe', 184000],
  ['Fernes Licht', 211000],
  ['Taschenlampe', 193000],
  ['Erste Reihe', 207000],
  ['Lange Brücke', 236000],
  ['Stiller Hafen', 188000],
  ['Neue Schuhe', 174000],
  ['Hohes Fenster', 201000],
  ['Letzter Refrain', 219000],
].map(([name, durationMs], index) => ({
  uri: `spotify:track:devsample${String(index + 1).padStart(2, '0')}`,
  name: String(name),
  artist: 'Dev Band',
  artists: ['Dev Band'],
  album: 'Fixtures',
  durationMs: Number(durationMs),
}));

const SPEAKER = {
  name: 'Dev-Lautsprecher',
  alias: 'Dev-Lautsprecher',
  address: '00:11:22:33:44:55',
  type: 'classic' as const,
  bondState: 'bonded' as const,
  majorClass: 'AUDIO_VIDEO',
  deviceClass: 1028,
  uuids: [] as string[],
  connected: true,
};

const listeners = new Set<WebDevListener>();

let trackIndex = 0;
let positionMs = 15000;
let paused = false;
let loggedIn = true;
let connected = true;
let failNext = false;
let btOn = true;
let scanEmpty = false;
let clientId = '0123456789abcdef0123456789abcdef';

export function subscribeWebDev(listener: WebDevListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: unknown) {
  listeners.forEach((listener) => listener(event, data));
}

export function fixtureTrack(): FixtureTrack {
  return TRACKS[trackIndex % TRACKS.length];
}

export function fixturePlayerState() {
  return {
    connected: loggedIn && connected,
    paused: paused || !connected,
    positionMs,
    playbackSpeed: paused || !connected ? 0 : 1,
    canSeek: true,
    track: loggedIn && connected ? fixtureTrack() : null,
  };
}

function bumpPlayer() {
  emit('spotify.player', fixturePlayerState());
}

function assertOk() {
  if (failNext) {
    failNext = false;
    const error = { message: 'Spotify-Fixture: Fehler' };
    emit('spotify.error', error);
    throw new Error(error.message);
  }
  if (!loggedIn) throw new Error('Spotify-Fixture: nicht angemeldet');
}

export const webSpotify = {
  isAvailable: async () => ({
    installed: true,
    connected: loggedIn && connected,
    authorized: loggedIn,
    premium: true as boolean | null,
  }),
  login: async () => {
    assertOk();
    loggedIn = true;
    connected = true;
    emit('spotify.connected', { fixture: true });
    bumpPlayer();
    return true;
  },
  logout: async () => {
    loggedIn = false;
    connected = false;
    emit('spotify.disconnected', { reason: 'logout' });
    return true;
  },
  connect: async () => {
    assertOk();
    connected = true;
    emit('spotify.connected', { fixture: true });
    bumpPlayer();
    return true;
  },
  disconnect: async () => {
    connected = false;
    emit('spotify.disconnected', { reason: 'disconnect' });
    return true;
  },
  play: async (uri: string, options?: { positionMs?: number }) => {
    assertOk();
    connected = true;
    const found = TRACKS.findIndex((track) => track.uri === uri);
    if (found >= 0) trackIndex = found;
    positionMs = Number(options?.positionMs) || 0;
    paused = false;
    bumpPlayer();
    return fixturePlayerState();
  },
  pause: async () => {
    assertOk();
    paused = true;
    bumpPlayer();
    return fixturePlayerState();
  },
  resume: async () => {
    assertOk();
    paused = false;
    connected = true;
    bumpPlayer();
    return fixturePlayerState();
  },
  stop: async () => {
    assertOk();
    paused = true;
    positionMs = 0;
    bumpPlayer();
    return fixturePlayerState();
  },
  skipNext: async () => {
    assertOk();
    trackIndex = (trackIndex + 1) % TRACKS.length;
    positionMs = 0;
    paused = false;
    bumpPlayer();
    return fixturePlayerState();
  },
  skipPrevious: async () => {
    assertOk();
    trackIndex = (trackIndex - 1 + TRACKS.length) % TRACKS.length;
    positionMs = 0;
    paused = false;
    bumpPlayer();
    return fixturePlayerState();
  },
  seek: async (ms: number) => {
    assertOk();
    positionMs = Math.max(0, Number(ms) || 0);
    bumpPlayer();
    return fixturePlayerState();
  },
  getPlayerState: async () => {
    assertOk();
    return fixturePlayerState();
  },
  search: async (query: string) => {
    assertOk();
    const q = String(query ?? '').trim().toLowerCase();
    const items = TRACKS.filter((track) => !q || track.name.toLowerCase().includes(q) || track.artist.toLowerCase().includes(q));
    return { tracks: { items: items.length ? items : TRACKS } };
  },
  getMe: async () => {
    assertOk();
    return { id: 'dev-user', displayName: 'Dev', product: 'premium', premium: true };
  },
  getMyPlaylists: async () => {
    assertOk();
    return { items: [{ id: 'dev-list', name: 'Dev-Liste', uri: 'spotify:playlist:dev-list' }] };
  },
  getSavedTracks: async () => {
    assertOk();
    return { items: TRACKS.map((track) => ({ track })) };
  },
  setClientId: async (id: string) => {
    clientId = String(id ?? '').trim();
    return webSpotify.getClientId();
  },
  getClientId: async () => ({
    clientId,
    source: 'settings' as const,
    settingsClientId: clientId,
    bridgeClientId: '',
    prefillClientId: '',
  }),
};

export function webBluetoothScan() {
  if (scanEmpty || !btOn) return [];
  return [{ ...SPEAKER, connected: btOn }];
}

export function webBluetoothConnect(deviceId: string) {
  btOn = true;
  const device = { ...SPEAKER, address: deviceId || SPEAKER.address, connected: true };
  emit('bluetooth.connected', device);
  return device;
}

export function webBluetoothDisconnect(deviceId: string) {
  btOn = false;
  const device = { ...SPEAKER, address: deviceId || SPEAKER.address, connected: false };
  emit('bluetooth.disconnected', device);
  return device;
}

export function webBluetoothConnected(includePaired: boolean) {
  if (btOn) return [{ ...SPEAKER, connected: true }];
  if (includePaired) return [{ ...SPEAKER, connected: false }];
  return [];
}

export function webMedia(action: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'stop') {
  if (action === 'play' || (action === 'toggle' && paused)) {
    paused = false;
    connected = true;
  } else if (action === 'pause' || action === 'stop' || (action === 'toggle' && !paused)) {
    paused = true;
    if (action === 'stop') positionMs = 0;
  } else if (action === 'next') {
    trackIndex = (trackIndex + 1) % TRACKS.length;
    positionMs = 0;
    paused = false;
  } else if (action === 'previous') {
    trackIndex = (trackIndex - 1 + TRACKS.length) % TRACKS.length;
    positionMs = 0;
    paused = false;
  }
  bumpPlayer();
  return true;
}

export function devSetPlaying() {
  loggedIn = true;
  connected = true;
  paused = false;
  failNext = false;
  bumpPlayer();
}

export function devSetPaused() {
  paused = true;
  bumpPlayer();
}

export function devSkipNext() {
  trackIndex = (trackIndex + 1) % TRACKS.length;
  positionMs = 0;
  paused = false;
  loggedIn = true;
  connected = true;
  bumpPlayer();
}

export function devFailNext() {
  failNext = true;
}

export function devLogOut() {
  loggedIn = false;
  connected = false;
  emit('spotify.disconnected', { reason: 'dev' });
}

export function devBluetoothOn() {
  btOn = true;
  scanEmpty = false;
  emit('bluetooth.connected', { ...SPEAKER, connected: true });
}

export function devScanEmpty() {
  scanEmpty = true;
}

export function devFixtureSnapshot() {
  return { track: fixtureTrack().name, paused, loggedIn, connected, btOn, scanEmpty, failNext };
}
