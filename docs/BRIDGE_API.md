# Erlaubte Bridge-API

`window.OpenScrBridge` ist die Schnittstelle einer OpenScrapp zu Gerätefunktionen. `window.EveryAppBridge` ist dasselbe Objekt und bleibt nur als Kompatibilität für bestehende OpenScrapps. Der native Teil nimmt nur Nachrichten an, die auf dieser Liste stehen. Unbekannte Methoden, unbekannte Events und unbekannte Nachrichtentypen werden abgelehnt. Argumente werden geprüft (Typ, Länge, `http`/`https` statt `file:` oder `content:`). Das Manifest heißt `openscr.json`. `everyapp.json` wird weiter gelesen, wenn keine `openscr.json` im Repository liegt.

Quelle der Liste: `src/bridge/allowlist.ts`.

## Nicht vorhanden

Die Bridge hat keine Methoden für das Dateisystem des Geräts, für Kontakte oder für den Standort. Es gibt keine GPS-Koordinaten. `network.requestLocation` ist entfernt. Der WLAN-Name hängt an der Berechtigung `network` und liefert keine Koordinaten.

Dateien der OpenScrapp selbst liest die WebView nur innerhalb ihres eigenen Ordners. Pfade mit `..` oder `file://` auf den Rest des Geräts werden verworfen.

## Zustimmung

Jede Kategorie außer dem reinen Event-Kanal braucht eine einmalige Zustimmung pro OpenScrapp. Sie wird unter `@everyapp_permissions` bzw. `@everyapp_permission_denied` gespeichert und kann unter „Info und Berechtigungen“ widerrufen werden. Steht die Funktion im Manifest, fragt OpenScr beim ersten Öffnen. Sonst beim ersten Aufruf.

## Speicher

- Schlüssel werden zu `@miniapp_<appId>_<schlüssel>`.
- Schlüssel: 1–128 Zeichen, keine Steuerzeichen.
- Werte: Text, höchstens 256 KiB.
- Löschen der OpenScrapp entfernt alle Schlüssel mit diesem Präfix, die Geheimnisse und die Berechtigungen. Ein Update tut das nicht.

## Rate-Limits

Laute Aufrufe sind begrenzt, darunter Scans, HTTP, Sensoren, Benachrichtigungen und UDP. Bei Überschreitung antwortet die Bridge mit „Zu viele Anfragen. Bitte kurz warten.“ Die Zähler gelten pro OpenScrapp und Methode.

## Methoden

Speicher: `storage.get`, `storage.set`, `storage.remove`

Spielernamen, gemeinsam für alle OpenScrapps auf diesem Gerät: `players.list`, `players.add({ name, tag })`, `players.update({ id, name, tag })`, `players.remove(id)`. Ein Eintrag ist ein Anzeigename aus 3 bis 16 Buchstaben oder Zahlen, Leerzeichen nur zwischen Wörtern, plus ein Tag aus 3 bis 5 Buchstaben oder Zahlen. Angezeigt wird `Name#Tag`. Die Kombination ist eindeutig, ohne Groß- und Kleinschreibung. Dafür ist keine Extra-Berechtigung nötig.

Geheimnisse: `secrets.get`, `secrets.set`, `secrets.delete`, `secrets.list`, `secrets.info`

HTTP: `http.request`, `http.fetch`, `net.fetch` (nur `http:` und `https:`). `net.fetch` läuft auf der React-Native-Seite. Grenzen und die Audio- und Binärfunktionen stehen in [BRIDGE_NEUTRAL.md](BRIDGE_NEUTRAL.md). Add-ons stehen in [ADDONS.md](ADDONS.md).

Bluetooth: `bluetooth.scan`, `bluetooth.connect`, `bluetooth.disconnect`, `bluetooth.getConnectedDevices`

Benachrichtigungen: `notifications.schedule` (fragt die Systemberechtigung, setzt den Namen der OpenScrapp vor den Titel, merkt die Kennung; Löschen der OpenScrapp entfernt ihre geplanten Meldungen)

Kamera: `camera.takePicture`, `camera.scanQr` (Vollbild-Vorschau mit Auslösen oder Abbrechen; Rückgabe ist eine JPEG-Daten-URI bzw. der gelesene Text; nichts geht in die Fotomediathek; kein Mikrofon)

Teilen: `share.text`, `share.exportFile` (Text über das Teilen-Menü; eine Datei nur in den App-Cache, danach das Teilen-Menü, damit sie zum Beispiel in „Dateien“ landet. Kein allgemeiner Dateizugriff.)

Sensoren: `sensors.getAccelerometer`, `sensors.getGyroscope`

Vibration: `vibration.vibrate`

Hintergrund: `background.enable`, `background.disable`, `background.isEnabled`, `background.handlesTriggers`, `background.getLog`, `background.clearLog`, `background.registerTask`, `background.unregisterTask`, `background.unregisterAll`, `background.listTasks`, `background.getTileSlots`, `background.setUi`, `background.getUi`, `background.tileUpdate`, `background.widgetUpdate`

Spotify: `spotify.isAvailable`, `spotify.login`, `spotify.logout`, `spotify.connect`, `spotify.disconnect`, `spotify.play`, `spotify.pause`, `spotify.resume`, `spotify.stop`, `spotify.skipNext`, `spotify.skipPrevious`, `spotify.seek`, `spotify.getPlayerState`, `spotify.search`, `spotify.getMe`, `spotify.getMyPlaylists`, `spotify.getSavedTracks`, `spotify.setClientId`, `spotify.getClientId`. Nach der ersten erfolgreichen App-Remote-Verbindung stellt OpenScr sie wieder her, wenn die OpenScrapp zurück in den Vordergrund kommt oder über der Sperre neu geöffnet wird, ohne Spotify-Fenster und ohne PIN. Die erste Freigabe (`connect`/`play`, solange Spotify noch nicht zugestimmt hat, und `login`) öffnet eine Spotify-Oberfläche und braucht ein entsperrtes Handy. Über der Sperre erscheint dann die Meldung, dass die erste Freigabe ein entsperrtes Handy braucht. `disconnect` und `logout` beenden die automatische Wiederverbindung.

Medientasten: `media.play`, `media.pause`, `media.toggle`, `media.next`, `media.previous`, `media.stop`

Netzinfo: `network.isAvailable`, `network.getInfo`, `network.getWifi`

Popup: `popup.open`, `popup.send`, `popup.close`, `popup.state`

Kacheln: `tiles.set`, `tiles.get`, `tiles.release`, `tiles.fetchSvg`

Lokales Netz: `net.isAvailable`, `net.tcpOpen`, `net.tcpSend`, `net.tcpReceive`, `net.tcpClose`, `net.udpSend`, `net.udpListen`, `net.tuyaStatus`, `net.tuyaSet`, `net.tuyaDiscover`

Kryptografie: `crypto.isAvailable`, `crypto.aesEcb`, `crypto.aesGcm`, `crypto.hmacSha256`, `crypto.md5`, `crypto.crc32`, `crypto.randomHex`

BLE: `ble.isAvailable`, `ble.scan`, `ble.connect`, `ble.disconnect`, `ble.write`, `ble.read`, `ble.notify`

Zwischenablage: `clipboard.setString`, `clipboard.getString` (Zustimmung pro OpenScrapp, danach die Systemzwischenablage)

Bildschirm: `OpenScrBridge.keepAwake.acquire()` / `OpenScrBridge.keepAwake.release()`. `acquire` hält wach, `release` gibt frei. Dieselbe Wirkung hat `screen.keepAwake(true|false)` (`true` oder ohne Argument hält wach). Die Kategorie `screen` braucht keine Zustimmung und keinen Eintrag in `openscr.json`. Sie schaltet nur den Schlaf des Bildschirms aus. Fehlt `expo-keep-awake` im Build, antwortet der Aufruf auf Deutsch, dass ein neuer Entwicklungs-Build fehlt. Im Browser-Gast sind `OpenScrBridge.keepAwake.acquire()` und `OpenScrBridge.keepAwake.release()` da und tun nichts, weil der Gast nicht den Bildschirm des Hosts hält.

Mehrspieler (Berechtigung `multiplayer`, Details in [MULTIPLAYER.md](MULTIPLAYER.md)): `multiplayer.host`, `multiplayer.join`, `multiplayer.send`, `multiplayer.broadcast`, `multiplayer.leave`, `multiplayer.showQr`, `multiplayer.showWifiQr`, `multiplayer.showGameQr`, `multiplayer.showHotspotQr`, `multiplayer.discover`, `multiplayer.stopDiscovery`, `multiplayer.setDiscoverable`, `multiplayer.approveJoin`, `multiplayer.denyJoin`, `multiplayer.endRoom`, `multiplayer.resume`. `showQr` öffnet die Einladung von OpenScr. `showWifiQr`, `showGameQr` und `showHotspotQr` öffnen dieselbe Einladung beim WLAN-Code, beim Spiel-Code oder beim Hotspot.

Events (nur diese Namen): `app.start`, `bluetooth.connected`, `bluetooth.disconnected`, `spotify.connected`, `spotify.disconnected`, `spotify.player`, `spotify.error`, `multiplayer.message`, `multiplayer.players`, `multiplayer.rooms`, `multiplayer.joinRequest`, `multiplayer.resumed`, `multiplayer.hostAway`. Bluetooth-, Spotify- und Mehrspieler-Events brauchen die passende Berechtigung. Die OpenScrapp speichert ihren Spielstand selbst. Token und Spielergeheimnis gibt die Bridge nicht heraus.

## iOS

Auf iOS ist die Bridge kürzer. Die Auswahl steht in `src/services/iosPolicy.ts` und hängt an der Plattform des Builds. Eine ferne Datei kann sie nicht erweitern.

Erlaubt: `storage.get`, `storage.set`, `storage.remove`, `http.request`, `http.fetch`, `net.fetch`, `sensors.getAccelerometer`, `sensors.getGyroscope`, `ble.isAvailable`, `ble.scan`, `ble.connect`, `ble.disconnect`, `ble.write`, `ble.read`, `ble.notify`, `vibration.vibrate`, `screen.keepAwake`, `clipboard.setString`, `clipboard.getString`, `share.text`, `share.exportFile`, `camera.takePicture`, `camera.scanQr`, `notifications.schedule`, dazu das Event `app.start`. `net.fetch` gehört zur Kategorie `http`. Audio, Dateiauswahl und `multiplayer.sendBinary` sind auf iOS nicht eingesetzt. Add-ons gibt es auf iOS nicht, siehe [ADDONS.md](ADDONS.md).

Nicht verfügbar, mit der Meldung „Diese Funktion ist auf iOS nicht verfügbar…“: Roh-Sockets und Tuya (`net.*`), Hintergrundaufgaben und Makros (`background.*`), Kacheln (`tiles.*`), Popups (`popup.*`), klassisches Bluetooth, Spotify, Medientasten, WLAN-Info, Geheimnisse, Kryptografie, Mehrspieler und die Fotomediathek. Es gibt kein `expo-image-picker` und kein `expo-media-library`. Android behält die volle Liste oben, einschließlich der neuen Teilen- und Kamera-Methoden.

## Melden

„Melden“ öffnet eine E-Mail an `krust3nkaese3@gmail.com` (Betreff und Text sind vorausgefüllt). Es wird kein Ticket-Server aufgerufen.
