const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPlayerParts, playerKey, formatPlayer } = require('../src/services/playerRoster.ts');

test('a riot-style name keeps spaces and ignores case in the key', () => {
  const parts = checkPlayerParts('  Mina  Wolf  ', 'ab3');
  assert.deepEqual(parts, { name: 'Mina Wolf', tag: 'ab3' });
  assert.equal(formatPlayer(parts), 'Mina Wolf#ab3');
  assert.equal(playerKey('Mina Wolf', 'AB3'), playerKey('mina wolf', 'ab3'));
});

test('a name rejects first and last style extras and a short tag', () => {
  assert.throws(() => checkPlayerParts('A', 'ABC'), /3 bis 16/);
  assert.throws(() => checkPlayerParts('Mina!', 'ABC'), /3 bis 16/);
  assert.throws(() => checkPlayerParts('Mina', 'AB'), /Tag/);
  assert.throws(() => checkPlayerParts(' Mina ', 'A B'), /Tag/);
});

const {
  applyPlayerStats,
  parseStatsRecords,
  readStat,
  statsAppFromProfile,
} = require('../src/services/playerRoster.ts');

test('the host maps known scrapps to a stats bucket and ignores others', () => {
  assert.equal(statsAppFromProfile({ repoUrl: 'https://github.com/Krust3nKaese3/WerwolfScrapp', name: 'Werwolf' }), 'werwolf');
  assert.equal(statsAppFromProfile({ repoUrl: 'https://github.com/Krust3nKaese3/GuessTheSongScrapp', name: 'Song raten' }), 'songraten');
  assert.equal(statsAppFromProfile({ repoUrl: 'https://github.com/Krust3nKaese3/ImposterDanceScrapp', name: 'Imposter Dance' }), null);
  assert.equal(statsAppFromProfile({}), null);
});

test('setStats merges one app and leaves names, ids, and the other app alone', () => {
  const rows = [
    { id: 'aaa111', name: 'Mina Wolf', tag: '7K2', songraten: { games: 4, wins: 1, points: 20, djSongs: 2, guessed: 3 } },
    { id: 'bbb222', name: 'Leo Sommer', tag: 'A1B' },
  ];
  const applied = applyPlayerStats(rows, 'werwolf', [
    { id: 'aaa111', games: 8, wins: 3, deaths: 5, roles: { werwolf: { games: 3, wins: 2, deaths: 1 }, hexe: { g: 5, w: 1, d: 4 } } },
    { id: 'missing', games: 9, wins: 9, deaths: 9 },
  ]);
  assert.equal(applied.updated, 1);
  assert.equal(applied.rows[0].name, 'Mina Wolf');
  assert.equal(applied.rows[0].tag, '7K2');
  assert.deepEqual(applied.rows[0].songraten, { games: 4, wins: 1, points: 20, djSongs: 2, guessed: 3 });
  assert.deepEqual(applied.rows[0].werwolf, {
    games: 8,
    wins: 3,
    deaths: 5,
    roles: {
      werwolf: { games: 3, wins: 2, deaths: 1 },
      hexe: { games: 5, wins: 1, deaths: 4 },
    },
  });
  assert.equal(applied.rows[1].werwolf, undefined);
  assert.equal(readStat(applied.rows[0], 'werwolf', 'wins'), 3);
  assert.equal(readStat(applied.rows[0], 'werwolf', 'games', 'hexe'), 5);
  assert.equal(readStat(applied.rows[1], 'werwolf', 'games'), 0);
});

test('the stats screen also reads compact aliases and a records payload', () => {
  const parsed = parseStatsRecords({
    records: [{ id: 'aaa111', g: 2, w: 1, d: 1, roles: { dorfbewohner: { got: 2, won: 1, deaths: 1 } } }],
  });
  const applied = applyPlayerStats(
    [{ id: 'aaa111', name: 'Mina Wolf', tag: '7K2' }],
    'werwolf',
    parsed,
  );
  assert.equal(readStat(applied.rows[0], 'werwolf', 'games'), 2);
  assert.equal(readStat(applied.rows[0], 'werwolf', 'wins'), 1);
  assert.equal(readStat(applied.rows[0], 'werwolf', 'deaths', 'dorfbewohner'), 1);
  const compact = { id: 'aaa111', werwolf: { g: 6, w: 2, d: 3, roles: { werwolf: { got: 2, won: 1, d: 1 } } } };
  assert.equal(readStat(compact, 'werwolf', 'games'), 6);
  assert.equal(readStat(compact, 'werwolf', 'wins', 'werwolf'), 1);
});
