import { requireOptionalNativeModule } from 'expo-modules-core';
const Native: any = requireOptionalNativeModule('ExpoNetworkInfo');
export const isAvailable = () => !!Native;
export async function getInfoAsync(): Promise<any> {
  if (!Native) throw new Error('Netzwerk-Info nicht verfügbar (braucht nächsten Build)');
  return await Native.getInfo();
}
/** {name, ip} für jede IPv4 außer Loopback. Der nächste Build liefert die Liste, auch auf iOS. */
export async function getLanCandidatesAsync(): Promise<{ name: string; ip: string }[]> {
  if (!Native || typeof Native.getLanCandidates !== 'function') throw new Error('Lokale Adressen nicht verfügbar (braucht nächsten Build)');
  const rows = await Native.getLanCandidates();
  return Array.isArray(rows) ? rows : [];
}
/** {ssid,bssid,rssi,frequency,linkSpeed,ip,error?} – needs next build */
export async function getWifiAsync(): Promise<any> {
  if (!Native || typeof Native.getWifi !== 'function') throw new Error('WLAN-Info (BSSID) nicht verfügbar (braucht nächsten Build)');
  return await Native.getWifi();
}
/** {ok, ssid, password, reason?} Lokaler Hotspot. Ein älterer Build hat die Funktion nicht. */
export async function startLocalOnlyHotspotAsync(): Promise<{ ok: boolean; ssid: string; password: string; reason?: string }> {
  if (!Native || typeof Native.startLocalOnlyHotspot !== 'function') throw new Error('Hotspot nicht verfügbar (braucht nächsten Build)');
  const row = await Native.startLocalOnlyHotspot();
  return {
    ok: row?.ok === true,
    ssid: typeof row?.ssid === 'string' ? row.ssid : '',
    password: typeof row?.password === 'string' ? row.password : '',
    reason: typeof row?.reason === 'string' ? row.reason : undefined,
  };
}
export function stopLocalOnlyHotspot(): void {
  if (Native && typeof Native.stopLocalOnlyHotspot === 'function') Native.stopLocalOnlyHotspot();
}
export function openTetherSettings(): boolean {
  if (!Native || typeof Native.openTetherSettings !== 'function') return false;
  return Native.openTetherSettings() === true;
}
/** {level, charging}. level ist -1, wenn der Stand fehlt. */
export async function getBatteryAsync(): Promise<{ level: number; charging: boolean }> {
  if (!Native || typeof Native.getBattery !== 'function') throw new Error('Akku nicht verfügbar (braucht nächsten Build)');
  const row = await Native.getBattery();
  return {
    level: typeof row?.level === 'number' ? row.level : -1,
    charging: row?.charging === true,
  };
}
