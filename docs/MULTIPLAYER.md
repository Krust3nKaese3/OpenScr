# Lokaler Mehrspieler

OpenScrapps wie WerwolfScrapp oder GuessTheSongScrapp brauchen keine eigene Netzwerklogik. Ein Gerät ist der Host im selben WLAN oder im Handy-Hotspot. Die anderen finden den Raum in der Nähe oder treten per QR-Code bei. Es geht ohne Internet und zwischen Android und iOS, sobald beide OpenScr aus einem Build mit `react-native-tcp-socket` und dem Modul `expo-mdns` starten.

Der Host ist allein zuständig: Nachrichten laufen nur über ihn, nie direkt von Gast zu Gast. Alles ist JSON. Eine Nachricht ist höchstens 32 KiB. Die OpenScrapp speichert ihren Spielstand selbst über `OpenScrBridge.storage`. OpenScr merkt sich nur den Raum.

## Berechtigung

In `openscr.json` (bestehende OpenScrapps mit `everyapp.json` laufen weiter):

```json
{
  "permissions": ["multiplayer"]
}
```

Ohne diese Zustimmung lehnt die Bridge `multiplayer.*` und die Events `multiplayer.message`, `multiplayer.players`, `multiplayer.rooms`, `multiplayer.joinRequest`, `multiplayer.resumed` und `multiplayer.hostAway` ab. Nachrichten einer anderen OpenScrapp oder eines anderen Raums werden nicht weitergeleitet.

Typen für den injizierten Client: `src/services/multiplayer/bridgeClient.ts` (`MultiplayerBridge`).

## API

`window.EveryAppBridge` ist dasselbe Objekt wie `window.OpenScrBridge` und bleibt nur als Kompatibilität.

```javascript
const mp = window.OpenScrBridge.multiplayer;

const offMessage = mp.onMessage((message) => {
  // message.from ist die Spieler-Id, message.data ist JSON
});
const offPlayers = mp.onPlayersChanged((roster) => {
  // roster.players: { id, name, host, connected }
  // roster.selfId, roster.roomCode
});

// Host. Vorgabe: der Raum ist in der Nähe sichtbar und ein Beitritt ohne Token braucht Zustimmung.
const room = await mp.host({ maxPlayers: 8, name: 'Ada', discoverable: true, joinApproval: true });
// room.roomCode, room.qrPayload, room.playerId, room.players

await mp.showQr();
await mp.showWifiQr();
await mp.showGameQr();
await mp.showHotspotQr();
await mp.setDiscoverable(false);

// Gast sucht nur Räume derselben OpenScrapp. Die Liste nennt Name, Raumcode und Spielerzahl, keine Adresse.
const stop = await mp.discover({
  onRooms: (rooms) => {
    // rooms: { id, roomCode, hostName, players, maxPlayers }
  },
});
await mp.join({ room: rooms[0].id, name: 'Bea' });
await mp.stopDiscovery();

// QR bleibt ohne Zustimmungsdialog. Schema openscr-mp://join?...
await mp.join({ scan: true, name: 'Bea' });
await mp.join(room.qrPayload);

// Beitritt über die Suche ist eine Anfrage. Entweder OpenScr zeigt den Dialog,
// oder die OpenScrapp hört selbst zu und entscheidet.
mp.onJoinRequest((request) => {
  // request.id, request.name, request.roomCode, request.hostName
  void mp.approveJoin(request.id);
  void mp.denyJoin(request.id);
});

await mp.send({ type: 'vote', choice: 'ja' });
await mp.send({ type: 'hint' }, { to: room.playerId });
await mp.broadcast({ type: 'state', phase: 'night' });

// Gast: Platz freigeben. Host: blendet nur aus, der Raum bleibt.
await mp.leave();
// Host beendet den Raum für alle.
await mp.endRoom();

// Nach dem erneuten Öffnen, auch nach einem Neustart der App.
const back = await mp.resume();
// back: { role, roomCode, selfId, players, status } und status ist 'ready' oder 'hostAway'
mp.onResumed((info) => {
  // Spielstand aus OpenScrBridge.storage lesen. Der Host schickt ihn danach an die Gäste.
});
mp.onHostAway((info) => {
  // info.message ist „Host ist kurz weg“. Die OpenScrapp wartet, OpenScr versucht es weiter.
});
```

`maxPlayers` liegt zwischen 2 und 16, Vorgabe 8. Der Host zählt mit. Der Anzeigename hat höchstens 24 Zeichen. `discoverable` ist standardmäßig an, `joinApproval` ebenfalls. Steht `joinApproval` auf `false`, kommt ein Gast aus der Suche ohne Dialog herein. Der QR-Weg fragt nie.

`send` ohne `to` geht vom Gast an den Host. Der Host muss `to` setzen oder `broadcast` nutzen.

Callbacks vor `host`, `join` oder `resume` anmelden. `resume()` liefert den Stand auch als Rückgabe, falls das Event vor dem Callback kam.

## Suche in der Nähe

Der Host meldet den Raum als `_openscr._tcp`. Im TXT-Record stehen nur die Protokollversion, die OpenScrapp-Id, der Raumcode, eine stabile Raum-Id, der Anzeigename (höchstens 24 Zeichen) und die Spielerzahlen. Token, Spielergeheimnis und IP stehen dort nicht. Die IP liefert die Suche selbst und bleibt in OpenScr.

`join({ room })` schickt eine Anfrage ohne Token. Erst nach Zustimmung gehen Token und Spielergeheimnis an dieses Gerät. Dieselbe Person kommt später mit dem gespeicherten Geheimnis wieder, ohne QR und ohne Dialog.

Eine fremde Ankündigung mit demselben Namen ist möglich. Die Liste zeigt deshalb den Namen und den Raumcode. Die OpenScrapp soll beides anzeigen, bevor sie beitritt.

## QR-Code

Der Code enthält die private IPv4-Adresse, den Port, einen Raumcode aus vier Zeichen und ein Token aus 16 Hex-Zeichen, dazu die Id der OpenScrapp. Beispiel:

`openscr-mp://join?v=1&host=192.168.1.20&port=38421&room=K7QP&token=0123456789abcdef&app=WerwolfScrapp`

Öffentliche Adressen werden abgelehnt. Der Installations-Scanner auf dem Startbildschirm ignoriert dieses Schema.

WLAN-Adressen (`wlan0`, `en0`) haben Vorrang. Ein Hotspot ohne WLAN-Client (typisch `ap0` oder `bridge100`, oft `172.20.10.1`) wird verwendet, wenn keine WLAN-Adresse da ist. Liegen WLAN und Hotspot gleichzeitig an, steht die WLAN-Adresse im Code. Dann müssen die Gäste in diesem WLAN sein.

## Verbindung

- Der Host hört auf TCP (`react-native-tcp-socket`), Port wird vom System vergeben. Nach einem Neustart darf der Port neu sein. Die Raum-Id bleibt.
- Etwa alle 3 Sekunden ein Ping. Antwortet jemand 10 Sekunden nicht, gilt die Verbindung als weg. Der Platz bleibt.
- Der Platz bleibt reserviert, bis der Gast `leave()` ruft oder der Host `endRoom()` aufruft. Dafür gibt der Host nur diesem Spieler ein Geheimnis. Die OpenScrapp sieht es nicht. Es liegt im app-eigenen Speicher (Secure Store, wenn das Modul da ist).
- Schließt man die OpenScrapp oder OpenScr, endet der Raum nicht. Android hält den Host im Hintergrund über den vorhandenen Vordergrunddienst, mit der sichtbaren Zeile „Spielraum, Browser-Gäste“, solange der Raum läuft. Der HTTP-Server für den Browser hängt an demselben Prozess. Android kann ihn trotzdem beenden. iOS hält den Host nicht im Hintergrund. Beim nächsten Öffnen startet der Raum neu, versucht denselben Browser-Port und meldet dieselbe Raum-Id.
- Während der Host-Raum läuft, hält OpenScr den Bildschirm wach. Sinkt der Akku auf 20 % oder weniger und das Gerät lädt nicht, sieht der Host „Akku niedrig“.
- Solange der Host weg ist, bekommen Gäste `multiplayer.hostAway` („Host ist kurz weg“) und versuchen es mit wachsendem Abstand weiter. Zuerst die gespeicherte Adresse, danach die Suche nach der Raum-Id, weil sich die IP ändern kann.
- `multiplayer.resume()` und das Event `multiplayer.resumed` liefern `{ role, roomCode, selfId, players, status }`. Den Spielstand muss die OpenScrapp selbst aus `OpenScrBridge.storage` holen. Der Host schickt ihn den Gästen danach.
- Ein gespeicherter Raum ohne Aktivität verschwindet nach 24 Stunden.
- Eine kurze Trennung puffert Spielnachrichten 20 Sekunden, höchstens 32 Stück, in beide Richtungen. Danach sind sie weg. Der Platz selbst bleibt länger.
- Pro Gerät nur ein Raum. Wer als Gast gespeichert ist, kann keinen neuen Raum öffnen, bevor `leave()` den Platz freigibt.

Spieler, die kurz weg sind, bleiben in `onPlayersChanged` mit `connected: false`.

## Browser-Gäste

Ein Gast ohne OpenScr scannt zwei QR-Codes und spielt im normalen Browser des Handys. Das gibt es nur auf Android. Auf iOS bietet die Bridge `multiplayer` nicht an, und OpenScr zeigt die Einladung nicht (`Platform.OS === 'android'`).

Der Host-Bildschirm fragt zuerst **WLAN** oder **Hotspot**.

- **WLAN:** OpenScr fragt Name und Passwort nicht ab. Der Hinweis lautet „Stellt sicher, dass ihr im selben WLAN seid“. **WLAN teilen** öffnet die Android-WLAN-Einstellungen (`android.settings.WIFI_SETTINGS`, sonst die App-Einstellungen). Dort tippt der Host das Netz und **Teilen**, und Android zeigt den System-QR. Der Spiel-Code `http://<ip>:<port>/g/<token>/` bleibt auf dem OpenScr-Bildschirm. `showWifiQr` öffnet genau diesen Bildschirm. Mitgegebene Zugangsdaten erzeugt er nicht.
- **Hotspot:** Ein Knopf startet auf Android einen `LocalOnlyHotspot`, wenn das Gerät die Zugangsdaten herausgibt. Dann entstehen beide Codes von selbst. Gibt Android SSID oder Passwort nicht heraus, oder der Start scheitert, öffnet OpenScr die Systemeinstellungen für den Hotspot und der Host trägt beides ein.

Die Codes bleiben erreichbar, auch mitten im Spiel: OpenScr blendet einen kleinen Knopf **Einladen** ein. Der kommt von OpenScr, nicht von der OpenScrapp.

Der Spiel-Code liefert die Dateien der geöffneten OpenScrapp und ein kleines Skript `openscr-guest.js`. Das Skript setzt `window.OpenScrBridge` und `window.EveryAppBridge`. `OpenScrBridge.guest` ist `true`. `spotify` und `storage` fehlen, damit die Seite den Browser erkennt. Die Mehrspieler-Methoden des Gasts sind dieselben wie in der App und laufen über WebSocket.

Die Seite, die der Spiel-Code öffnet, ist schon der Raum. Das Shim verbindet sofort, der Anzeigename ist der gespeicherte Name oder `Gast`. `resume()` liefert `{ role: 'guest', roomCode, selfId, players, status: 'ready' }`, sobald das Willkommen da ist. Ist der Socket schon offen, kommt dieselbe Antwort sofort. `status` ist `hostAway` nur, solange der Socket nach einem Abbruch noch fehlt. Die OpenScrapp parst die Adresse nicht und öffnet keinen eigenen Socket.

`join`, `send`, `broadcast`, `leave`, `resume`, `onMessage`, `onPlayersChanged`, `onJoinRequest`, `onResumed`, `onHostAway`, `showQr`, `showWifiQr`, `showGameQr`, `showHotspotQr`.

Die Form ist dieselbe wie in der App: `host`, `join`, `send`, `broadcast` und die Events. `host`, `discover`, `showQr`, `showWifiQr`, `showGameQr`, `showHotspotQr`, `approveJoin`, `denyJoin`, `endRoom` und `setDiscoverable` lehnen im Browser ab: „Im Browser ist nur die Gast-Ansicht da.“ `keepAwake.acquire` und `keepAwake.release` sind da und tun im Browser nichts.

### Was eine OpenScrapp dafür tun muss

Dieselbe Seite läuft in der WebView des Hosts und im Browser der Gäste. Der Browser ist immer Gast.

```javascript
const bridge = window.OpenScrBridge;
const mp = bridge.multiplayer;

mp.onMessage((message) => {
  // Voller Spielstand ersetzt den lokalen Stand. message.data kommt vom Host.
});
mp.onPlayersChanged((roster) => {});
mp.onResumed((info) => {});
mp.onHostAway((info) => {});

if (bridge.guest === true) {
  const back = await mp.resume();
  // back.role === 'guest', back.status === 'ready', back.selfId ist der Platz.
} else {
  const back = await mp.resume();
  if (!back) await mp.host({ name: 'Ada' });
}
```

Callbacks vor `resume`, `join` oder `host` anmelden. Der Host schickt den für Gäste sichtbaren Stand mit `broadcast`, sobald er sich ändert. OpenScr merkt sich diesen letzten `broadcast` und schickt ihn einem Browser-Gast nach dem Willkommen erneut, also nach einem Reload, nach einem Verbindungsabbruch und nach einem Neustart von OpenScr.

In den 20 Sekunden nach einem Abbruch bleiben zusätzlich die Spielnachrichten liegen, die der Host in der Lücke per `send` oder `broadcast` geschickt hat, und die Nachrichten, die der Gast in der Lücke abgeschickt hat. Nach dem erneuten Willkommen gehen sie in der alten Reihenfolge raus, höchstens 32 Stück. Das gilt für den App-Gast und den Browser-Gast. Danach sind sie weg. Der letzte `broadcast` an den Browser bleibt die Ausnahme und kommt auch nach einem längeren Reload noch einmal. Die OpenScrapp soll den Stand ersetzen, nicht anstückeln. `storage` gibt es im Browser nicht. Den Stand gibt es nur aus `onMessage`.

Die Identität liegt im `localStorage` des Browsers (`playerId`, Geheimnis, Name, Raumcode). Dieselbe Person belegt nach dem Neuladen denselben Platz. Ein App-Gast nutzt weiter sein gespeichertes Geheimnis in OpenScr. Daran ändert der Browser-Weg nichts.

`OpenScrBridge.guest` ist in der App `undefined`. Nur die ausgelieferte Gastseite setzt es.

### Im Browser nicht da

`storage` und `spotify` sind nicht gesetzt. Die übrigen Aufrufe antworten mit „Im Browser-Gast nicht verfügbar.“:

- Geheimnisse (`secrets`)
- Medientasten, Bluetooth, BLE
- Kamera, Sensoren, Vibration, Benachrichtigungen
- Hintergrund, Kacheln, Popups
- Netzinfo, Roh-Sockets, HTTP über die Bridge, Kryptografie, Zwischenablage
- Bildschirm wachhalten (`OpenScrBridge.keepAwake.acquire` / `release`, dasselbe wie `screen.keepAwake`)

Der Gast-Browser hat seine eigene `fetch`-Funktion. Die Bridge-Methode `http` ist es nicht. Der WebSocket zum Host bleibt offen und verbindet sich mit wachsendem Abstand neu. Solange der Host weg ist, kommt `multiplayer.hostAway` mit „Host ist kurz weg“.

Wer die Spiel-Adresse hat, kann die Dateien dieser OpenScrapp im lokalen Netz lesen und mit dem Token beitreten. Das Token steht nicht in der Nahsuche. Öffentliche Adressen nimmt der Server nicht in den Code auf.

## Nativer Build

Diese Funktion steckt nicht in Expo Go und nicht in einem älteren OpenScr-Build. Nötig sind:

- das native Modul `react-native-tcp-socket` (Config-Plugin `with-react-native-tcp-socket`)
- das lokale Modul `modules/expo-mdns` (Android `NsdManager`, iOS `NetService`)
- Android: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`. `NEARBY_WIFI_DEVICES` mit `neverForLocation` nur, damit der Host den lokalen Hotspot selbst starten kann. Kein GPS. `CHANGE_WIFI_MULTICAST_STATE` nur im Modul und nur, solange gesucht oder angekündigt wird. Standort ist dafür nicht nötig.
- Browser-Gäste, die QR-Codes und der letzte Spielstand laufen in JavaScript auf `react-native-tcp-socket`. Hotspot, Akku-Warnung und `screen.keepAwake` brauchen einen Build, der `expo-keep-awake` und die neuen Funktionen in `expo-network-info` enthält.
- iOS: Die Bridge bietet `multiplayer` nicht an. `NSLocalNetworkUsageDescription` und `NSBonjourServices` werden nicht gesetzt. Mehrspieler bleibt die Android-Funktion.

Ohne das mDNS-Modul bleibt der QR-Code nutzbar. `discover()` antwortet dann auf Deutsch, dass ein neuer Entwicklungs-Build fehlt.

Diesen Build hier nicht starten, bevor er gewollt ist. Bis dahin antwortet die API auf Deutsch, dass ein neuer Entwicklungs-Build fehlt.

Was ein Gerät im selben WLAN trotzdem kann, steht in [MULTIPLAYER_SECURITY.md](MULTIPLAYER_SECURITY.md). Für OpenScrapp-Autoren, die einer KI nur einen Link geben: [MINIAPP_AI_GUIDE.md](MINIAPP_AI_GUIDE.md) und [llms.txt](../llms.txt).
