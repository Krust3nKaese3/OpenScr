/**
 * Zwischenspeicher der Add-ons. Auf iOS macht keine Funktion einen Zugriff.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addonsAvailable } from '../iosPolicy';
import { downloadAddon } from './download';
import { CachedAddon, injectionForScrapp, ScrappRef, AddonInjection } from './inject';
import { readAddonGithubToken } from './githubToken';

const KEY = '@openscr_addons_v1';

export async function listAddons(platform: string): Promise<CachedAddon[]> {
  if (!addonsAvailable(platform)) return [];
  return readAll();
}

export async function addAddonRepo(platform: string, repoUrl: string): Promise<CachedAddon> {
  if (!addonsAvailable(platform)) throw new Error('Add-ons gibt es auf diesem Gerät nicht.');
  const token = await readAddonGithubToken();
  const downloaded = await downloadAddon(repoUrl, token);
  const all = await readAll();
  const previous = all.find((item) => item.id === downloaded.id);
  downloaded.enabled = previous ? previous.enabled : true;
  const next = all.filter((item) => item.id !== downloaded.id && item.repoUrl !== downloaded.repoUrl);
  next.push(downloaded);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return downloaded;
}

export async function setAddonEnabled(platform: string, id: string, enabled: boolean): Promise<void> {
  if (!addonsAvailable(platform)) return;
  const all = await readAll();
  const row = all.find((item) => item.id === id);
  if (!row) throw new Error('Add-on ist nicht installiert.');
  row.enabled = enabled;
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

export async function removeAddon(platform: string, id: string): Promise<void> {
  if (!addonsAvailable(platform)) return;
  const all = (await readAll()).filter((item) => item.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

export async function refreshAddons(platform: string): Promise<void> {
  if (!addonsAvailable(platform)) return;
  const token = await readAddonGithubToken();
  const all = await readAll();
  const next: CachedAddon[] = [];
  for (const row of all) {
    try {
      const downloaded = await downloadAddon(row.repoUrl, token);
      downloaded.enabled = row.enabled;
      next.push(downloaded);
    } catch {
      next.push(row);
    }
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function prepareAddonInjection(platform: string, scrapp: ScrappRef): Promise<AddonInjection> {
  if (!addonsAvailable(platform)) return { script: '', icons: [], errors: [], loaded: [] };
  try {
    const all = await readAll();
    return injectionForScrapp(all, scrapp);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Add-ons konnten nicht gelesen werden.';
    return { script: '', icons: [], errors: [{ id: '', name: 'Add-ons', message }], loaded: [] };
  }
}

async function readAll(): Promise<CachedAddon[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isCached) : [];
  } catch {
    return [];
  }
}

function isCached(value: unknown): value is CachedAddon {
  if (!value || typeof value !== 'object') return false;
  const row = value as CachedAddon;
  return typeof row.id === 'string' && typeof row.entry === 'string' && row.files && typeof row.files === 'object';
}
