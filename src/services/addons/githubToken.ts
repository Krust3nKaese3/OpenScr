/**
 * Ein optionales GitHub-Token nur für Add-on-Repositories.
 * Liegt in expo-secure-store. Wird nie geloggt und nie an andere Hosts geschickt.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const KEY = 'openscr_addon_gh_token';

const Secure: {
  getValueWithKeyAsync?: (key: string, options: object) => Promise<string | null>;
  setValueWithKeyAsync?: (value: string, key: string, options: object) => Promise<void>;
  deleteValueWithKeyAsync?: (key: string, options: object) => Promise<void>;
} | null = (() => {
  try {
    const mod = requireOptionalNativeModule('ExpoSecureStore');
    if (!mod || typeof mod.getValueWithKeyAsync !== 'function') return null;
    return mod;
  } catch {
    return null;
  }
})();

export function addonTokenStoreAvailable(): boolean {
  return !!Secure;
}

export async function readAddonGithubToken(): Promise<string | null> {
  if (!Secure?.getValueWithKeyAsync) return null;
  const value = await Secure.getValueWithKeyAsync(KEY, {});
  const token = typeof value === 'string' ? value.trim() : '';
  return token || null;
}

export async function writeAddonGithubToken(token: string): Promise<void> {
  const clean = String(token || '').trim();
  if (!clean || clean.length > 256) throw new Error('Das Token ist ungültig.');
  if (!Secure?.setValueWithKeyAsync) {
    throw new Error('Sichere Ablage fehlt in diesem Build. Das Token wird nicht gespeichert.');
  }
  await Secure.setValueWithKeyAsync(clean, KEY, {});
}

export async function clearAddonGithubToken(): Promise<void> {
  if (Secure?.deleteValueWithKeyAsync) {
    try { await Secure.deleteValueWithKeyAsync(KEY, {}); } catch { /* schon weg */ }
  }
}
