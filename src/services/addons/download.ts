/**
 * Lädt ein Add-on-Repository. Das Token geht nur an api.github.com und raw.githubusercontent.com
 * für genau dieses Repository.
 */
import { githubApiGet, githubFailureMessage, rawGithubHeaders, type GithubFetch } from '../githubApi';
import { commitApiUrl, githubRawUrlAtRef, parseCommitSha, treeApiUrl } from '../githubPin';
import { parseGitHubRepo } from '../miniAppFiles';
import { CachedAddon } from './inject';
import { parseAddonManifest } from './manifest';

const MAX_FILES = 24;
const MAX_FILE = 256 * 1024;
const MAX_TOTAL = 1024 * 1024;

export async function downloadAddon(
  repoUrl: string,
  token: string | null,
  fetchImpl: GithubFetch = fetch as GithubFetch,
): Promise<CachedAddon> {
  const { owner, repo } = parseGitHubRepo(repoUrl);
  const commit = await getJson(fetchImpl, commitApiUrl(owner, repo), token);
  const sha = parseCommitSha(commit);
  const treeBody = await getJson(fetchImpl, treeApiUrl(owner, repo, sha), token);
  const tree = (treeBody as { tree?: { path?: string; type?: string }[]; truncated?: boolean }).tree || [];
  if ((treeBody as { truncated?: boolean }).truncated) {
    throw new Error('Das Add-on-Repository ist zu groß.');
  }
  const jsFiles = tree.filter((item) => item.type === 'blob' && item.path && /\.(m|c)?js$/i.test(item.path) && !item.path.split('/').includes('..'));
  if (jsFiles.length > MAX_FILES) throw new Error('Das Add-on hat zu viele JavaScript-Dateien.');
  const manifestUrl = githubRawUrlAtRef(owner, repo, sha, 'addon.json');
  const manifestText = await getText(fetchImpl, manifestUrl, token);
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    throw new Error('addon.json ist kein gültiges JSON.');
  }
  const manifest = parseAddonManifest(manifestJson);
  const files: Record<string, string> = {};
  let total = manifestText.length;
  for (const item of jsFiles) {
    const path = String(item.path);
    const text = await getText(fetchImpl, githubRawUrlAtRef(owner, repo, sha, path), token);
    if (text.length > MAX_FILE) throw new Error(`${path} ist größer als 256 KiB.`);
    total += text.length;
    if (total > MAX_TOTAL) throw new Error('Das Add-on ist größer als 1 MiB.');
    files[path] = text;
  }
  if (!files[manifest.entry]) throw new Error(`Einstieg ${manifest.entry} fehlt im Repository.`);
  return {
    ...manifest,
    repoUrl: `https://github.com/${owner}/${repo}`,
    commitSha: sha,
    enabled: true,
    files,
  };
}

async function getJson(fetchImpl: GithubFetch, url: string, token: string | null): Promise<unknown> {
  assertGithubHost(url);
  const result = await githubApiGet(url, token, fetchImpl);
  if (result.status === 404) throw new Error('GitHub-Anfrage fehlgeschlagen (404).');
  try {
    return JSON.parse(result.body);
  } catch {
    throw new Error('GitHub-Antwort ist kein JSON.');
  }
}

async function getText(fetchImpl: GithubFetch, url: string, token: string | null): Promise<string> {
  assertGithubHost(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    let response: Awaited<ReturnType<GithubFetch>>;
    try {
      response = await fetchImpl(url, { headers: rawGithubHeaders(token), signal: ctrl.signal, cache: 'no-store' });
    } catch {
      throw new Error('GitHub ist nicht erreichbar.');
    }
    const body = await response.text();
    if (!response.ok) {
      throw new Error(githubFailureMessage({
        status: response.status,
        headers: response.headers,
        bodyText: body,
        authenticated: !!token,
      }));
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function assertGithubHost(url: string): void {
  let host = '';
  try { host = new URL(url).host; } catch { host = ''; }
  if (host !== 'api.github.com' && host !== 'raw.githubusercontent.com') {
    throw new Error('Add-ons werden nur von GitHub geladen.');
  }
}
