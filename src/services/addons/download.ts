/**
 * Lädt ein Add-on-Repository. Das Token geht nur an api.github.com und raw.githubusercontent.com
 * für genau dieses Repository.
 */
import { commitApiUrl, githubRawUrlAtRef, parseCommitSha, treeApiUrl } from '../githubPin';
import { parseGitHubRepo } from '../miniAppFiles';
import { CachedAddon } from './inject';
import { parseAddonManifest } from './manifest';

const MAX_FILES = 24;
const MAX_FILE = 256 * 1024;
const MAX_TOTAL = 1024 * 1024;

type FetchImpl = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function downloadAddon(
  repoUrl: string,
  token: string | null,
  fetchImpl: FetchImpl = fetch,
): Promise<CachedAddon> {
  const { owner, repo } = parseGitHubRepo(repoUrl);
  const headers = githubHeaders(token);
  const commit = await getJson(fetchImpl, commitApiUrl(owner, repo), headers);
  const sha = parseCommitSha(commit);
  const treeBody = await getJson(fetchImpl, treeApiUrl(owner, repo, sha), headers);
  const tree = (treeBody as { tree?: { path?: string; type?: string }[]; truncated?: boolean }).tree || [];
  if ((treeBody as { truncated?: boolean }).truncated) {
    throw new Error('Das Add-on-Repository ist zu groß.');
  }
  const jsFiles = tree.filter((item) => item.type === 'blob' && item.path && /\.(m|c)?js$/i.test(item.path) && !item.path.split('/').includes('..'));
  if (jsFiles.length > MAX_FILES) throw new Error('Das Add-on hat zu viele JavaScript-Dateien.');
  const manifestUrl = githubRawUrlAtRef(owner, repo, sha, 'addon.json');
  const manifestText = await getText(fetchImpl, manifestUrl, headers);
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
    const text = await getText(fetchImpl, githubRawUrlAtRef(owner, repo, sha, path), headers);
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

function githubHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'OpenScr',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getJson(fetchImpl: FetchImpl, url: string, headers: Record<string, string>): Promise<unknown> {
  const text = await getText(fetchImpl, url, headers);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('GitHub-Antwort ist kein JSON.');
  }
}

async function getText(fetchImpl: FetchImpl, url: string, headers: Record<string, string>): Promise<string> {
  assertGithubHost(url);
  let response: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    response = await fetchImpl(url, { headers });
  } catch {
    throw new Error('GitHub ist nicht erreichbar.');
  }
  if (!response.ok) throw new Error(`GitHub antwortet mit ${response.status}.`);
  return response.text();
}

function assertGithubHost(url: string): void {
  let host = '';
  try { host = new URL(url).host; } catch { host = ''; }
  if (host !== 'api.github.com' && host !== 'raw.githubusercontent.com') {
    throw new Error('Add-ons werden nur von GitHub geladen.');
  }
}
