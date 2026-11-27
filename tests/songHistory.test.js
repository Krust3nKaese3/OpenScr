const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  configureSongHistoryStore,
  addPlayedSong,
  listPlayedSongs,
  listSongSources,
  clearPlayedSongs,
  pruneSongEntries,
  songDedupeKey,
  sanitizeSongText,
  SONG_WINDOW_MS,
  SONG_HISTORY_LIMIT,
} = require('../src/services/songHistory.ts');
const { bridgeMethod } = require('../src/bridge/allowlist.ts');
const { assessBridgeCall } = require('../src/services/iosPolicy.ts');

const HOUR = 60 * 60 * 1000;

function memoryStore() {
  let raw = null;
  return {
    get: async () => raw,
    set: async (value) => { raw = value; },
    raw: () => raw,
  };
}

const guess = {
  id: 'app-guess',
  name: 'Song raten',
  repoUrl: 'https://github.com/Krust3nKaese3/GuessTheSongScrapp',
};
const dance = {
  id: 'app-dance',
  name: 'Imposter Dance',
  repoUrl: 'https://github.com/Krust3nKaese3/ImposterDanceScrapp',
};

test('Titel werden bereinigt und Dubletten hängen an Quelle, Titel und Künstler', () => {
  assert.strictEqual(sanitizeSongText('  Hello\nWorld  '), 'Hello World');
  assert.strictEqual(sanitizeSongText('x'.repeat(250)).length, 200);
  assert.strictEqual(songDedupeKey('Song A', 'Band', 'app'), songDedupeKey('  song   a ', 'band', 'app'));
  assert.notStrictEqual(songDedupeKey('Song A', 'Band', 'app'), songDedupeKey('Song A', 'Andere', 'app'));
  assert.notStrictEqual(songDedupeKey('Song A', 'Band', 'app'), songDedupeKey('Song A', 'Band', 'other'));
});

test('24-Stunden-Fenster bleibt über Mitternacht und verwirft den Vortag', () => {
  const midnight = Date.UTC(2026, 10, 28, 0, 0, 0);
  const kept = {
    title: 'Spät',
    source: 'app-guess',
    sourceName: 'Song raten',
    playedAt: midnight - 30 * 60 * 1000,
  };
  const gone = {
    title: 'Gestern',
    source: 'app-guess',
    sourceName: 'Song raten',
    playedAt: midnight - 25 * HOUR,
  };
  const pruned = pruneSongEntries([gone, kept], midnight + 60 * 1000);
  assert.deepStrictEqual(pruned.map((entry) => entry.title), ['Spät']);
  const still = pruneSongEntries([kept], midnight + 23 * HOUR);
  assert.strictEqual(still.length, 1);
  const after = pruneSongEntries([kept], midnight - 30 * 60 * 1000 + SONG_WINDOW_MS + 1);
  assert.strictEqual(after.length, 0);
});

describe('gemeinsamer Speicher', { concurrency: 1 }, () => {
test('add, list und clear teilen den Speicher und falten Dubletten', async () => {
  configureSongHistoryStore(memoryStore());
  const t0 = Date.UTC(2026, 10, 27, 18, 0, 0);
  await addPlayedSong(guess, { title: 'Alt', artist: 'X' }, t0 - 30 * HOUR);
  await addPlayedSong(guess, { title: '  Blinding   Lights ', artist: 'The Weeknd' }, t0);
  await addPlayedSong(guess, { title: 'blinding lights', artist: 'the weeknd' }, t0 + HOUR);
  await addPlayedSong(dance, { title: 'Levitating', artist: 'Dua Lipa' }, t0 + 2 * HOUR);

  const own = await listPlayedSongs(guess, {}, [guess, dance], t0 + 3 * HOUR);
  assert.deepStrictEqual(own.map((entry) => entry.title), ['Levitating', 'Blinding Lights']);
  const mine = own.find((entry) => entry.source === 'app-guess');
  assert.strictEqual(mine.playedAt, t0 + HOUR);
  assert.strictEqual(mine.sourceName, 'Song raten');

  const others = await listPlayedSongs(dance, { excludeSelf: true }, [guess, dance], t0 + 3 * HOUR);
  assert.deepStrictEqual(others.map((entry) => entry.title), ['Blinding Lights']);

  const byRepo = await listPlayedSongs(
    dance,
    { source: 'Krust3nKaese3/GuessTheSongScrapp', excludeSelf: true },
    [guess, dance],
    t0 + 3 * HOUR,
  );
  assert.strictEqual(byRepo.length, 1);
  const byName = await listPlayedSongs(dance, { source: 'song-raten' }, [guess, dance], t0 + 3 * HOUR);
  assert.strictEqual(byName[0].title, 'Blinding Lights');

  const sources = await listSongSources(t0 + 3 * HOUR);
  assert.deepStrictEqual(sources, [
    { source: 'app-dance', sourceName: 'Imposter Dance', count: 1 },
    { source: 'app-guess', sourceName: 'Song raten', count: 1 },
  ]);

  const cleared = await clearPlayedSongs(guess.id, t0 + 3 * HOUR);
  assert.deepStrictEqual(cleared, { ok: true });
  const left = await listPlayedSongs(dance, {}, [guess, dance], t0 + 3 * HOUR);
  assert.deepStrictEqual(left.map((entry) => entry.title), ['Levitating']);
});

test('Deckel und Bridge-Signatur', async () => {
  configureSongHistoryStore(memoryStore());
  const start = Date.UTC(2026, 10, 27, 12, 0, 0);
  for (let i = 0; i < SONG_HISTORY_LIMIT + 5; i += 1) {
    await addPlayedSong(guess, { title: `Titel ${i}` }, start + i);
  }
  const rows = await listPlayedSongs(guess, {}, [guess], start + SONG_HISTORY_LIMIT + 5);
  assert.strictEqual(rows.length, SONG_HISTORY_LIMIT);
  assert.strictEqual(rows[0].title, `Titel ${SONG_HISTORY_LIMIT + 4}`);

  const add = bridgeMethod('songHistory.add');
  assert.strictEqual(add.category, 'songHistory');
  assert.strictEqual(add.rate.max, 30);
  assert.strictEqual(add.rate.windowMs, 60_000);
  assert.deepStrictEqual(add.validate([{ title: 'A', artist: 'B', source: 'fremd' }]), [{ title: 'A', artist: 'B' }]);
  assert.strictEqual(bridgeMethod('songHistory.list').validate([]).length, 1);
  assert.strictEqual(assessBridgeCall('ios', 'songHistory.add'), null);
  assert.strictEqual(assessBridgeCall('android', 'songHistory.sources'), null);
});
});
