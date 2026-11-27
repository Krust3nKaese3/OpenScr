/**
 * addon.json einer OpenScr-Erweiterung. Reines Prüfen, ohne Netzwerk.
 */
import { parseGitHubRepo } from '../miniAppFiles';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VER_RE = /^\d{1,6}(\.\d{1,6}){0,3}$/;

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  icon: string;
  targetScrapp: string;
  minScrappVersion: string;
  entry: string;
}

export function parseAddonManifest(raw: unknown): AddonManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('addon.json ist kein Objekt.');
  }
  const row = raw as Record<string, unknown>;
  const id = needString(row.id, 'id', 64);
  if (!ID_RE.test(id)) throw new Error('addon.json: id nur Kleinbuchstaben, Ziffern und Bindestrich.');
  const name = needString(row.name, 'name', 60);
  const version = needVersion(row.version, 'version');
  const icon = needString(row.icon, 'icon', 32);
  const targetScrapp = needString(row.targetScrapp, 'targetScrapp', 160);
  const minScrappVersion = needVersion(row.minScrappVersion, 'minScrappVersion');
  const entry = needString(row.entry, 'entry', 120);
  if (entry.startsWith('/') || entry.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('addon.json: entry ist kein relativer Pfad.');
  }
  if (!/\.(m|c)?js$/i.test(entry)) throw new Error('addon.json: entry muss eine JavaScript-Datei sein.');
  return { id, name, version, icon, targetScrapp, minScrappVersion, entry };
}

export function parseVersion(value: string): number[] {
  if (!VER_RE.test(value)) throw new Error(`Versionsnummer ist ungültig: ${value}`);
  return value.split('.').map((part) => Number(part));
}

/** true, wenn current >= min. */
export function versionAtLeast(current: string, min: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(min);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

/** Wirft eine klare Meldung, wenn das Add-on nicht zu dieser OpenScrapp passt. */
export function addonFitsScrapp(
  addon: { targetScrapp: string; minScrappVersion: string },
  scrapp: { id: string; repoUrl: string; name: string; version: string },
): void {
  if (!scrappMatchesTarget(addon.targetScrapp, scrapp)) {
    throw new Error(
      `targetScrapp ist „${addon.targetScrapp}“. Das passt nicht zu dieser OpenScrapp (${scrapp.name}).`,
    );
  }
  if (!versionAtLeast(scrapp.version, addon.minScrappVersion)) {
    throw new Error(
      `minScrappVersion ist ${addon.minScrappVersion}. Diese OpenScrapp ist ${scrapp.version || 'ohne Version'}.`,
    );
  }
}

/**
 * Gemeinsamer Schlüssel für targetScrapp und die OpenScrapp:
 * trimmen, kleinschreiben, Leerzeichen und Unterstriche zu '-', mehrfache Bindestriche zusammenziehen.
 */
export function normalizeScrappTarget(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

export function scrappMatchesTarget(
  target: string,
  app: { id: string; repoUrl: string; name: string },
): boolean {
  const want = normalizeScrappTarget(target);
  if (!want) return false;
  const keys = [app.id, app.name];
  try {
    const { owner, repo } = parseGitHubRepo(app.repoUrl);
    keys.push(`${owner}/${repo}`, repo);
  } catch {
    /* ohne GitHub-URL bleibt der Vergleich bei id und Name */
  }
  return keys.some((key) => normalizeScrappTarget(key) === want);
}

function needString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`addon.json: ${label} fehlt.`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`addon.json: ${label} ist ungültig.`);
  return text;
}

function needVersion(value: unknown, label: string): string {
  const text = needString(value, label, 24);
  parseVersion(text);
  return text;
}
