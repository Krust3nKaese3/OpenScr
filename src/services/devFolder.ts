/**
 * Dev-only link from an installed scrapp to a folder on this computer.
 * The browser cannot read the disk, so the local guest server serves the files.
 */
const STORE = 'openscr-dev-folders-v1';
const DEV = 'http://127.0.0.1:8791';

export function devFoldersEnabled(): boolean {
  return typeof document !== 'undefined' && typeof __DEV__ !== 'undefined' && __DEV__;
}

function readMap(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE);
    const parsed = raw ? JSON.parse(raw) as Record<string, string> : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function devFolderFor(appId: string): string {
  if (!devFoldersEnabled()) return '';
  return String(readMap()[appId] || '').trim();
}

export function setDevFolder(appId: string, folder: string): void {
  if (!devFoldersEnabled() || typeof localStorage === 'undefined') return;
  const map = readMap();
  const next = folder.trim();
  if (next) map[appId] = next;
  else delete map[appId];
  localStorage.setItem(STORE, JSON.stringify(map));
}

export interface DevAsset {
  mime: string;
  base64: string;
  text: string | null;
  stamp: string;
}

async function devGet(appId: string, query: string): Promise<Response | null> {
  const root = devFolderFor(appId);
  if (!root) return null;
  const response = await fetch(`${DEV}/openscr-dev-dir?root=${encodeURIComponent(root)}&${query}`);
  if (response.status === 404 && query.startsWith('rel=')) return null;
  if (!response.ok) throw new Error((await response.text()) || 'Der Ordner auf dem PC konnte nicht gelesen werden. Pfad prüfen und die Webseite neu laden.');
  return response;
}

export async function readDevAsset(appId: string, rel: string): Promise<DevAsset | null> {
  const response = await devGet(appId, `rel=${encodeURIComponent(rel)}`);
  if (!response) return null;
  return response.json() as Promise<DevAsset>;
}

export async function listDevFiles(appId: string): Promise<{ stamp: string; files: string[] } | null> {
  const response = await devGet(appId, 'list=1');
  if (!response) return null;
  return response.json() as Promise<{ stamp: string; files: string[] }>;
}
