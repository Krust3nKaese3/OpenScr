/**
 * Bildschirm wachhalten über expo-keep-awake.
 * Fehlt das Modul, bleibt der Aufruf eine klare Meldung statt eines Absturzes.
 */
const MISSING = 'Bildschirm wachhalten braucht einen neuen Entwicklungs-Build mit expo-keep-awake.';

export async function setKeepAwake(tag: string, on: boolean): Promise<void> {
  let mod: {
    activateKeepAwakeAsync?: (tag?: string) => Promise<void>;
    activateKeepAwake?: (tag?: string) => Promise<void>;
    deactivateKeepAwake?: (tag?: string) => Promise<void>;
  };
  try {
    mod = require('expo-keep-awake');
  } catch {
    throw new Error(MISSING);
  }
  if (on) {
    if (typeof mod.activateKeepAwakeAsync === 'function') {
      await mod.activateKeepAwakeAsync(tag);
      return;
    }
    if (typeof mod.activateKeepAwake === 'function') {
      await mod.activateKeepAwake(tag);
      return;
    }
    throw new Error(MISSING);
  }
  if (typeof mod.deactivateKeepAwake === 'function') await mod.deactivateKeepAwake(tag);
}

export const HOST_AWAKE_TAG = 'openscr-host';
