/**
 * Skript, das nach dem Code der OpenScrapp läuft, und die Leiste der aktiven Add-ons.
 */
import { AddonManifest, scrappMatchesTarget, versionAtLeast } from './manifest';

export interface CachedAddon extends AddonManifest {
  repoUrl: string;
  commitSha: string;
  enabled: boolean;
  /** Relativer Pfad → Quelltext. Nur JavaScript. */
  files: Record<string, string>;
}

export interface ScrappRef {
  id: string;
  repoUrl: string;
  name: string;
  version: string;
}

export interface AddonInjection {
  script: string;
  icons: { id: string; name: string; icon: string }[];
  errors: { id: string; name: string; message: string }[];
  loaded: { id: string; name: string; version: string; icon: string }[];
}

export function addonsForScrapp(addons: readonly CachedAddon[], scrapp: ScrappRef): CachedAddon[] {
  return addons.filter((addon) => scrappMatchesTarget(addon.targetScrapp, scrapp));
}

/** Aktive Icons auf der Karte: höchstens `limit`, der Rest als Anzahl. */
export function activeAddonMarks(
  addons: readonly CachedAddon[],
  scrapp: ScrappRef,
  limit = 3,
): { shown: { id: string; name: string; icon: string }[]; extra: number } {
  const active = addonsForScrapp(addons, scrapp).filter((addon) => addon.enabled);
  const shown = active.slice(0, limit).map((addon) => ({ id: addon.id, name: addon.name, icon: addon.icon }));
  return { shown, extra: Math.max(0, active.length - shown.length) };
}

export function injectionForScrapp(addons: readonly CachedAddon[], scrapp: ScrappRef): AddonInjection {
  const icons: AddonInjection['icons'] = [];
  const errors: AddonInjection['errors'] = [];
  const loaded: AddonInjection['loaded'] = [];
  const blocks: string[] = [];
  for (const addon of addons) {
    if (!addon.enabled) continue;
    if (!scrappMatchesTarget(addon.targetScrapp, scrapp)) continue;
    icons.push({ id: addon.id, name: addon.name, icon: addon.icon });
    try {
      if (!versionAtLeast(scrapp.version, addon.minScrappVersion)) {
        throw new Error(
          `OpenScrapp ${scrapp.version} ist älter als minScrappVersion ${addon.minScrappVersion}.`,
        );
      }
      const entry = addon.entry.replace(/^\.\//, '');
      if (!Object.prototype.hasOwnProperty.call(addon.files, entry)) {
        throw new Error(`Einstieg ${addon.entry} fehlt im Zwischenspeicher.`);
      }
      const order = Object.keys(addon.files).filter((name) => name !== entry).sort();
      order.push(entry);
      for (const name of order) {
        blocks.push(wrapFile(addon.id, name, addon.files[name]));
      }
      loaded.push({ id: addon.id, name: addon.name, version: addon.version, icon: addon.icon });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Add-on konnte nicht geladen werden.';
      errors.push({ id: addon.id, name: addon.name, message });
    }
  }
  const detail = { loaded, errors };
  const script = `${blocks.join('\n')}<script>(function(){var detail=${json(detail)};window.dispatchEvent(new CustomEvent('openscr:addon',{detail:detail}));})();</script>`;
  return { script, icons, errors, loaded };
}

function wrapFile(id: string, name: string, source: string): string {
  const safe = source.replace(/<\/script/gi, '<\\/script');
  return `<script>try{\n${safe}\n}catch(e){window.__openscrAddonErrors=window.__openscrAddonErrors||[];window.__openscrAddonErrors.push({id:${json(id)},file:${json(name)},message:String((e&&e.message)||e)});}</script>`;
}

function json(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
