/**
 * WLAN-Passwort, das der Host freiwillig merkt.
 * Liegt nur auf diesem Gerät und nur, wenn die Person das auswählt.
 */
export interface WifiStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

let override: WifiStore | null = null;

export function configureWifiStore(store: WifiStore | null): void {
  override = store;
}

async function activeStore(): Promise<WifiStore> {
  if (override) return override;
  const AsyncStorage = require('@react-native-async-storage/async-storage').default as WifiStore & {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
  };
  return {
    get: () => AsyncStorage.getItem('@openscr_wifi_share'),
    set: (value) => AsyncStorage.setItem('@openscr_wifi_share', value),
  };
}

function asMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === 'string') out[key] = value;
    });
    return out;
  } catch {
    return {};
  }
}

export async function loadWifiPassword(ssid: string): Promise<string> {
  if (!ssid) return '';
  const map = asMap(await (await activeStore()).get());
  return map[ssid] || '';
}

export async function rememberWifiPassword(ssid: string, password: string, remember: boolean): Promise<void> {
  if (!ssid) return;
  const store = await activeStore();
  const map = asMap(await store.get());
  if (remember && password) map[ssid] = password;
  else delete map[ssid];
  await store.set(JSON.stringify(map));
}
