/**
 * Per-OpenScrapp choice: show the open scrapp over the Android lock screen.
 * Off unless the map stores true. The native call lives behind a function so
 * tests can use the map without React Native.
 */

export const SHOW_OVER_LOCK_KEY = '@openscr_show_over_lock';

export function readShowOverLockMap(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const map: Record<string, boolean> = {};
    for (const [id, on] of Object.entries(value)) {
      if (on === true) map[id] = true;
    }
    return map;
  } catch {
    return {};
  }
}

export function showOverLockEnabled(map: Record<string, boolean>, appId: string): boolean {
  return map[appId] === true;
}

export function withShowOverLock(
  map: Record<string, boolean>,
  appId: string,
  on: boolean,
): Record<string, boolean> {
  const next = { ...map };
  if (on) next[appId] = true;
  else delete next[appId];
  return next;
}

/** Only an open Android scrapp with the setting on may sit over the lock screen. */
export function shouldShowOverLock(platform: string, enabled: boolean, scrappOpen: boolean): boolean {
  return platform === 'android' && enabled === true && scrappOpen === true;
}

/** Lock-screen notification title and the action "Werwolf öffnen". */
export function overLockNoticeCopy(name: string): { title: string; action: string } {
  const title = (name || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'OpenScrapp';
  return { title, action: `${title} öffnen` };
}

/** Same URL the Android notice opens. `lock` is not an OpenScrapp name. */
export function overLockLaunchUrl(appId: string): string {
  return `openscr://lock?id=${encodeURIComponent(appId)}`;
}

export function showOverLockNativeReady(): boolean {
  return nativeSet() != null && nativeNotice() != null;
}

/** Applies or clears the activity flag. No-op off Android and on older builds. */
export function applyShowOverLock(on: boolean): boolean {
  const set = nativeSet();
  if (!set) return false;
  try {
    return set(on) === true;
  } catch {
    return false;
  }
}

/** Shows or refreshes the dismissible lock-screen notice for this OpenScrapp. */
export async function publishOverLockNotice(appId: string, name: string): Promise<boolean> {
  await ensurePostNotifications();
  const set = nativeNotice();
  if (!set) return false;
  const copy = overLockNoticeCopy(name);
  try {
    return set(appId, copy.title, copy.action, true) === true;
  } catch {
    return false;
  }
}

/** Drops the notice when it points at this OpenScrapp. */
export function clearOverLockNotice(appId: string): boolean {
  const set = nativeNotice();
  if (!set) return false;
  try {
    return set(appId, '', '', false) === true;
  } catch {
    return false;
  }
}

async function ensurePostNotifications(): Promise<void> {
  let platform = '';
  let version = 0;
  let permissions: { request: (permission: string) => Promise<string> } | null = null;
  try {
    const rn = require('react-native');
    platform = rn.Platform.OS;
    version = Number(rn.Platform.Version) || 0;
    permissions = rn.PermissionsAndroid;
  } catch {
    return;
  }
  if (platform !== 'android' || version < 33 || !permissions) return;
  try {
    await permissions.request('android.permission.POST_NOTIFICATIONS');
  } catch {
    /* The notice stays hidden until the person allows notifications. */
  }
}

function nativeModule(): { setShowOverLock?: (on: boolean) => boolean; setOverLockNotice?: (appId: string, title: string, action: string, enabled: boolean) => boolean } | null {
  let platform = '';
  try {
    platform = require('react-native').Platform.OS;
  } catch {
    return null;
  }
  if (platform !== 'android') return null;
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core');
    return requireOptionalNativeModule('ExpoBackgroundService');
  } catch {
    return null;
  }
}

function nativeSet(): ((on: boolean) => boolean) | null {
  const native = nativeModule();
  if (!native || typeof native.setShowOverLock !== 'function') return null;
  return (on: boolean) => native.setShowOverLock!(on);
}

function nativeNotice(): ((appId: string, title: string, action: string, enabled: boolean) => boolean) | null {
  const native = nativeModule();
  if (!native || typeof native.setOverLockNotice !== 'function') return null;
  return (appId, title, action, enabled) => native.setOverLockNotice!(appId, title, action, enabled);
}
