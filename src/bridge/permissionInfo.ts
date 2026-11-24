import { Permission } from '../types';

export const PERMISSION_INFO: Record<Permission, { title: string; description: string }> = {
  storage: {
    title: 'Speicher',
    description: 'Text nur für diese OpenScrapp auf diesem Gerät speichern',
  },
  http: {
    title: 'Internet',
    description: 'Anfragen an Server im Internet oder im lokalen Netz senden',
  },
  bluetooth: {
    title: 'Bluetooth',
    description: 'Bluetooth-Geräte suchen und verbinden',
  },
  notifications: {
    title: 'Benachrichtigungen',
    description: 'Lokale Benachrichtigungen anzeigen. Der Titel beginnt mit dem Namen dieser OpenScrapp',
  },
  camera: {
    title: 'Kamera',
    description: 'Ein Foto aufnehmen oder einen QR-Code scannen. Nichts landet in der Fotomediathek. Kein Mikrofon',
  },
  sensors: {
    title: 'Sensoren',
    description: 'Beschleunigung und Drehung des Geräts lesen',
  },
  vibration: {
    title: 'Vibration',
    description: 'Das Gerät vibrieren lassen',
  },
  background: {
    title: 'Hintergrund',
    description: 'Weiterarbeiten, wenn OpenScr nicht geöffnet ist',
  },
  ble: {
    title: 'Bluetooth LE',
    description: 'BLE-Geräte suchen, verbinden und lesen oder schreiben',
  },
  net: {
    title: 'Lokales Netzwerk',
    description: 'Direkte Verbindungen im lokalen Netz, zum Beispiel zu Lampen',
  },
  popup: {
    title: 'Popups',
    description: 'Einblendungen über Kacheln oder Widgets öffnen',
  },
  tiles: {
    title: 'Kacheln',
    description: 'Schnellkacheln ändern',
  },
  spotify: {
    title: 'Spotify',
    description: 'Die installierte Spotify-App durchsuchen und die Wiedergabe steuern',
  },
  clipboard: {
    title: 'Zwischenablage',
    description: 'Text in die Zwischenablage legen oder daraus lesen. Gilt nur für diese OpenScrapp',
  },
  share: {
    title: 'Teilen',
    description: 'Text teilen oder eine Datei über das Teilen-Menü sichern. Kein Zugriff auf den übrigen Speicher',
  },
  network: {
    title: 'WLAN-Info',
    description: 'Verbindungsdaten wie den WLAN-Namen lesen. Keine GPS-Koordinaten',
  },
  media: {
    title: 'Medientasten',
    description: 'Wiedergabe anderer Apps steuern, zum Beispiel Play oder Pause',
  },
  secrets: {
    title: 'Geheimnisse',
    description: 'Zugangsdaten nur für diese OpenScrapp auf diesem Gerät speichern',
  },
  crypto: {
    title: 'Kryptografie',
    description: 'Verschlüsselung und Prüfsummen auf dem Gerät berechnen',
  },
  multiplayer: {
    title: 'Mehrspieler',
    description: 'Einen Spielraum im selben WLAN oder Hotspot öffnen und Nachrichten nur an Mitspieler dieser OpenScrapp senden',
  },
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_INFO) as Permission[];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERMISSION_INFO, value);
}
