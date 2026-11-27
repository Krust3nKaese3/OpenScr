/**
 * GitHub-REST-Aufrufe für Installieren, Aktualisieren und Öffnen.
 * Dateiinhalte laufen über raw.githubusercontent.com, nicht über die Contents-API.
 * Erfolgreiche API-Antworten merken sich das ETag. 304 zählt nicht auf das Limit.
 * Fehler und Limit-Antworten werden nicht gemerkt, ein erneuter Versuch geht wieder ins Netz.
 */

export const GITHUB_API_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'OpenScr',
  'X-GitHub-Api-Version': '2022-11-28',
};

type CachedBody = { etag: string; body: string };

const conditionalCache = new Map<string, CachedBody>();
const MAX_CACHED_BODY = 1_500_000;

export type GithubHeaderSource =
  | { get?: (name: string) => string | null }
  | Record<string, string>
  | undefined
  | null;

export type GithubFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; cache?: RequestCache },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers?: GithubHeaderSource;
}>;

export type GithubGetResult = {
  status: number;
  body: string;
  authenticated: boolean;
};

export function clearGithubConditionalCache(): void {
  conditionalCache.clear();
}

export function githubConditionalCacheSize(): number {
  return conditionalCache.size;
}

export function headerValue(headers: GithubHeaderSource, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const read = (headers as { get: (headerName: string) => string | null }).get;
    const direct = read.call(headers, name);
    if (direct != null && String(direct) !== '') return String(direct);
    const lower = read.call(headers, wanted);
    if (lower != null && String(lower) !== '') return String(lower);
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((item) => item.toLowerCase() === wanted);
  if (!key || record[key] == null || record[key] === '') return null;
  return String(record[key]);
}

export function formatLocalReset(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return 'unbekannt';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function githubBodyMessage(body: string | undefined): string {
  if (!body) return '';
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (parsed && typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim().slice(0, 240);
    }
  } catch {
    /* Klartext */
  }
  return trimmed.slice(0, 180);
}

/** Limit nur bei 403/429 und x-ratelimit-remaining 0. Sonst Status und Meldung. */
export function githubFailureMessage(input: {
  status: number;
  headers?: GithubHeaderSource;
  bodyText?: string;
  authenticated: boolean;
}): string {
  const remaining = headerValue(input.headers, 'x-ratelimit-remaining');
  const limited = (input.status === 403 || input.status === 429) && remaining != null && remaining.trim() === '0';
  if (limited) {
    const reset = headerValue(input.headers, 'x-ratelimit-reset');
    const when = reset && /^\d+$/.test(reset.trim()) ? formatLocalReset(Number(reset.trim())) : 'unbekannt';
    const auth = input.authenticated ? 'Anfrage angemeldet' : 'Anfrage nicht angemeldet';
    return `GitHub-API-Limit erreicht (${auth}). Zurücksetzen: ${when}. Status ${input.status}.`;
  }
  const detail = githubBodyMessage(input.bodyText);
  return detail
    ? `GitHub-Anfrage fehlgeschlagen (${input.status}). ${detail}`
    : `GitHub-Anfrage fehlgeschlagen (${input.status}).`;
}

export function githubRequestHeaders(token?: string | null, etag?: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...GITHUB_API_HEADERS };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers['If-None-Match'] = etag;
  if (typeof globalThis !== 'undefined' && 'document' in globalThis) delete headers['User-Agent'];
  return headers;
}

export function rawGithubHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'OpenScr' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (typeof globalThis !== 'undefined' && 'document' in globalThis) delete headers['User-Agent'];
  return headers;
}

function rememberSuccess(url: string, headers: GithubHeaderSource, body: string): void {
  if (body.length > MAX_CACHED_BODY) return;
  const etag = headerValue(headers, 'etag');
  if (!etag) return;
  conditionalCache.set(url, { etag, body });
}

export async function githubApiGet(
  url: string,
  token?: string | null,
  fetchImpl: GithubFetch = fetch as GithubFetch,
): Promise<GithubGetResult> {
  const cached = conditionalCache.get(url) || null;
  const headers = githubRequestHeaders(token, cached?.etag);
  const authenticated = !!token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    let response: Awaited<ReturnType<GithubFetch>>;
    try {
      // cache no-store: die Plattform (OkHttp auf Android) soll eine 403 nicht wiederverwenden.
      response = await fetchImpl(url, { headers, signal: ctrl.signal, cache: 'no-store' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`GitHub nicht erreichbar: ${message}`);
    }
    if (response.status === 304) {
      if (!cached) {
        throw new Error('GitHub-Anfrage fehlgeschlagen (304). Keine gespeicherte Antwort für eine erneute Prüfung.');
      }
      return { status: 304, body: cached.body, authenticated };
    }
    const body = await response.text();
    if (response.status === 401) {
      throw new Error('GitHub hat die Anmeldung abgelehnt. Bitte im Entwicklermodus erneut anmelden.');
    }
    if (response.status === 404) {
      return { status: 404, body, authenticated };
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(githubFailureMessage({
        status: response.status,
        headers: response.headers,
        bodyText: body,
        authenticated,
      }));
    }
    rememberSuccess(url, response.headers, body);
    return { status: response.status, body, authenticated };
  } finally {
    clearTimeout(timer);
  }
}
