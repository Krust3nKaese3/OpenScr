/**
 * WLAN-Name, lokaler Hotspot und Akku. Alles optional: ein älterer Build antwortet ohne diese Funktionen.
 */
export interface HotspotResult {
  ok: boolean;
  ssid: string;
  password: string;
  detail: string;
}

export async function readWifiLabel(): Promise<{ ssid: string; detail: string }> {
  try {
    const mod = require('../../../modules/expo-network-info') as {
      getInfoAsync?: () => Promise<{ ssid?: string; ssidError?: string }>;
    };
    if (typeof mod.getInfoAsync !== 'function') return { ssid: '', detail: 'WLAN-Name nicht lesbar. Bitte eintragen.' };
    const info = await mod.getInfoAsync();
    const ssid = typeof info?.ssid === 'string' ? info.ssid.trim() : '';
    if (ssid && ssid !== '<unknown ssid>') return { ssid, detail: '' };
    return { ssid: '', detail: info?.ssidError || 'Android zeigt den WLAN-Namen hier nicht. Bitte eintragen.' };
  } catch {
    return { ssid: '', detail: 'WLAN-Name nicht lesbar. Bitte eintragen.' };
  }
}

export async function startHotspot(): Promise<HotspotResult> {
  const denied = await ensureNearbyWifi();
  if (denied) return { ok: false, ssid: '', password: '', detail: denied };
  try {
    const mod = require('../../../modules/expo-network-info') as {
      startLocalOnlyHotspotAsync?: () => Promise<{ ok?: boolean; ssid?: string; password?: string; reason?: string }>;
    };
    if (typeof mod.startLocalOnlyHotspotAsync !== 'function') {
      return {
        ok: false,
        ssid: '',
        password: '',
        detail: 'Hotspot aus der App braucht einen neuen Build. Schalte ihn in den Systemeinstellungen ein und trag SSID und Passwort hier ein.',
      };
    }
    const result = await mod.startLocalOnlyHotspotAsync();
    const ssid = typeof result?.ssid === 'string' ? result.ssid : '';
    const password = typeof result?.password === 'string' ? result.password : '';
    if (result?.ok && ssid && password) return { ok: true, ssid, password, detail: '' };
    if (result?.ok) {
      return {
        ok: false,
        ssid,
        password,
        detail: 'Der Hotspot läuft, Android gibt SSID und Passwort aber nicht heraus. Lies sie in den Systemeinstellungen ab und trag sie hier ein.',
      };
    }
    return {
      ok: false,
      ssid: '',
      password: '',
      detail: 'Der Hotspot ließ sich nicht starten. Schalte ihn in den Systemeinstellungen ein und trag SSID und Passwort hier ein.',
    };
  } catch {
    return {
      ok: false,
      ssid: '',
      password: '',
      detail: 'Der Hotspot ließ sich nicht starten. Schalte ihn in den Systemeinstellungen ein und trag SSID und Passwort hier ein.',
    };
  }
}

export function stopHotspot(): void {
  try {
    const mod = require('../../../modules/expo-network-info') as { stopLocalOnlyHotspot?: () => void };
    if (typeof mod.stopLocalOnlyHotspot === 'function') mod.stopLocalOnlyHotspot();
  } catch {
    /* Kein Hotspot aus diesem Build. */
  }
}

export async function openTetherSettings(): Promise<void> {
  try {
    const mod = require('../../../modules/expo-network-info') as { openTetherSettings?: () => boolean };
    if (typeof mod.openTetherSettings === 'function') mod.openTetherSettings();
  } catch {
    /* Älterer Build: die Person öffnet die Einstellungen selbst. */
  }
}

export async function readHostBattery(): Promise<{ level: number; charging: boolean }> {
  try {
    const mod = require('../../../modules/expo-network-info') as {
      getBatteryAsync?: () => Promise<{ level?: number; charging?: boolean }>;
    };
    if (typeof mod.getBatteryAsync !== 'function') return { level: -1, charging: false };
    const info = await mod.getBatteryAsync();
    const level = typeof info?.level === 'number' && Number.isFinite(info.level) ? info.level : -1;
    return { level, charging: info?.charging === true };
  } catch {
    return { level: -1, charging: false };
  }
}

async function ensureNearbyWifi(): Promise<string> {
  try {
    const { PermissionsAndroid, Platform } = require('react-native') as {
      Platform: { OS: string; Version: number | string };
      PermissionsAndroid: { request: (name: string) => Promise<string>; RESULTS: { GRANTED: string } };
    };
    if (Platform.OS !== 'android') return '';
    const version = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    if (!version || version < 33) return '';
    const result = await PermissionsAndroid.request('android.permission.NEARBY_WIFI_DEVICES');
    if (result === PermissionsAndroid.RESULTS.GRANTED) return '';
    return 'Ohne die Berechtigung für Geräte in der Nähe kann OpenScr den Hotspot nicht selbst starten.';
  } catch {
    return '';
  }
}
