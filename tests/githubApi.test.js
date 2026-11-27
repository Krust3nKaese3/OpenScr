const test = require('node:test');
const assert = require('node:assert');
const {
  clearGithubConditionalCache,
  githubConditionalCacheSize,
  githubApiGet,
  githubFailureMessage,
  githubRequestHeaders,
  formatLocalReset,
} = require('../src/services/githubApi.ts');

function headers(map) {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

test('Limit nur bei 403/429 und remaining 0, mit Reset und Anmeldung', () => {
  const reset = String(Math.floor(Date.UTC(2026, 10, 27, 15, 5) / 1000));
  const when = formatLocalReset(Number(reset));
  const limited = githubFailureMessage({
    status: 403,
    headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
    bodyText: JSON.stringify({ message: 'API rate limit exceeded' }),
    authenticated: false,
  });
  assert.match(limited, /GitHub-API-Limit erreicht \(Anfrage nicht angemeldet\)/);
  assert.match(limited, /Status 403/);
  assert.ok(limited.includes(when));
  const authed = githubFailureMessage({
    status: 429,
    headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
    authenticated: true,
  });
  assert.match(authed, /Anfrage angemeldet/);
  assert.match(authed, /Status 429/);
  const forbidden = githubFailureMessage({
    status: 403,
    headers: headers({ 'x-ratelimit-remaining': '42' }),
    bodyText: JSON.stringify({ message: 'Resource not accessible' }),
    authenticated: true,
  });
  assert.doesNotMatch(forbidden, /API-Limit/);
  assert.match(forbidden, /fehlgeschlagen \(403\)/);
  assert.match(forbidden, /Resource not accessible/);
  const bare = githubFailureMessage({
    status: 403,
    headers: headers({}),
    bodyText: 'nope',
    authenticated: false,
  });
  assert.doesNotMatch(bare, /API-Limit/);
  assert.match(bare, /fehlgeschlagen \(403\)/);
});

test('Token geht an api.github.com, ETag wird genutzt, Limit wird nicht gemerkt', async () => {
  clearGithubConditionalCache();
  const url = 'https://api.github.com/repos/o/r/commits/main';
  const seen = [];
  const body = JSON.stringify({ sha: 'a'.repeat(40) });
  let calls = 0;
  const fetchImpl = async (requestUrl, init) => {
    calls += 1;
    seen.push(init.headers);
    assert.strictEqual(requestUrl, url);
    assert.strictEqual(init.cache, 'no-store');
    if (calls === 1) {
      assert.strictEqual(init.headers.Authorization, 'Bearer session-token');
      assert.strictEqual(init.headers['If-None-Match'], undefined);
      return { ok: true, status: 200, headers: headers({ etag: '"sha"' }), text: async () => body };
    }
    if (calls === 2) {
      assert.strictEqual(init.headers['If-None-Match'], '"sha"');
      assert.strictEqual(init.headers.Authorization, 'Bearer session-token');
      return { ok: false, status: 304, headers: headers({ etag: '"sha"' }), text: async () => '' };
    }
    return {
      ok: false,
      status: 403,
      headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
      text: async () => JSON.stringify({ message: 'API rate limit exceeded' }),
    };
  };
  const first = await githubApiGet(url, 'session-token', fetchImpl);
  assert.strictEqual(first.body, body);
  assert.strictEqual(githubConditionalCacheSize(), 1);
  const second = await githubApiGet(url, 'session-token', fetchImpl);
  assert.strictEqual(second.status, 304);
  assert.strictEqual(second.body, body);
  await assert.rejects(() => githubApiGet(url, 'session-token', fetchImpl), /API-Limit erreicht \(Anfrage angemeldet\)/);
  assert.strictEqual(githubConditionalCacheSize(), 1);
  const anon = githubRequestHeaders(null);
  assert.strictEqual(anon.Authorization, undefined);
  clearGithubConditionalCache();
  let thirdHeaders;
  await assert.rejects(
    () => githubApiGet(url, 'session-token', async (_url, init) => {
      thirdHeaders = init.headers;
      return {
        ok: false,
        status: 403,
        headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
        text: async () => '{}',
      };
    }),
    /API-Limit/,
  );
  assert.strictEqual(thirdHeaders['If-None-Match'], undefined);
  assert.strictEqual(thirdHeaders.Authorization, 'Bearer session-token');
  assert.strictEqual(githubConditionalCacheSize(), 0);
  const retry = await githubApiGet(url, 'session-token', async (_url, init) => {
    assert.strictEqual(init.headers.Authorization, 'Bearer session-token');
    assert.strictEqual(init.headers['If-None-Match'], undefined);
    return { ok: true, status: 200, headers: headers({}), text: async () => body };
  });
  assert.strictEqual(retry.status, 200);
  clearGithubConditionalCache();
});
