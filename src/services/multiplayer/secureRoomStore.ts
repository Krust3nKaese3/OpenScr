/**
 * SecureStore, sobald das native Modul da ist. Sonst nur der laufende Prozess.
 * AsyncStorage bekommt diese Secrets nicht.
 */
import { createMemoryRoomStore, type RoomStore, type StoredRoom } from './persist';

const memory = createMemoryRoomStore();
const KEY = (appId: string) => `eamp.${appId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)}`;
const SNAP_KEY = (appId: string) => `@openscr_mp_snap_${appId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)}`;

function asyncStorage(): { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> } | null {
  try {
    const loaded = require('@react-native-async-storage/async-storage');
    const store = loaded.default || loaded;
    if (typeof store.getItem !== 'function') return null;
    return store;
  } catch {
    return null;
  }
}

async function readSnapshot(appId: string): Promise<{ snapshot: unknown; seq: number } | null> {
  const store = asyncStorage();
  if (!store) return null;
  const raw = await store.getItem(SNAP_KEY(appId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { snapshot?: unknown; seq?: number };
    if (!parsed || !('snapshot' in parsed)) return null;
    return { snapshot: parsed.snapshot, seq: typeof parsed.seq === 'number' ? parsed.seq : 0 };
  } catch {
    return null;
  }
}

async function writeSnapshot(appId: string, snapshot: unknown, seq: number | undefined): Promise<void> {
  const store = asyncStorage();
  if (!store) return;
  if (snapshot == null) {
    await store.removeItem(SNAP_KEY(appId));
    return;
  }
  await store.setItem(SNAP_KEY(appId), JSON.stringify({ snapshot, seq: seq || 0 }));
}

async function deleteSnapshot(appId: string): Promise<void> {
  const store = asyncStorage();
  if (!store) return;
  await store.removeItem(SNAP_KEY(appId));
}

function secure(): { getItemAsync?: (key: string) => Promise<string | null>; setItemAsync?: (key: string, value: string) => Promise<void>; deleteItemAsync?: (key: string) => Promise<void> } | null {
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core');
    const native = requireOptionalNativeModule('ExpoSecureStore');
    // The JS wrapper exists on web, but the native method does not.
    if (!native || typeof native.getValueWithKeyAsync !== 'function') return null;
    const loaded = require('expo-secure-store');
    if (typeof loaded.getItemAsync !== 'function' || typeof loaded.setItemAsync !== 'function') return null;
    return loaded;
  } catch {
    return null;
  }
}

export function roomStore(): RoomStore {
  return {
    async read(appId) {
      const store = secure();
      if (!store?.getItemAsync) return memory.read(appId);
      const raw = await store.getItemAsync(KEY(appId));
      if (!raw) return null;
      try {
        const room = JSON.parse(raw) as StoredRoom;
        const snap = await readSnapshot(appId);
        if (snap) {
          room.snapshot = snap.snapshot;
          room.snapshotSeq = snap.seq;
        }
        return room;
      } catch {
        return null;
      }
    },
    async write(room) {
      const store = secure();
      if (!store?.setItemAsync) {
        await memory.write(room);
        return;
      }
      const { snapshot, snapshotSeq, ...rest } = room;
      await store.setItemAsync(KEY(room.appId), JSON.stringify(rest));
      await writeSnapshot(room.appId, snapshot, snapshotSeq);
    },
    async delete(appId) {
      const store = secure();
      await deleteSnapshot(appId);
      if (!store?.deleteItemAsync) {
        await memory.delete(appId);
        return;
      }
      await store.deleteItemAsync(KEY(appId));
    },
  };
}
