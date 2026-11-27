# Neutrale Bridge

Nichts in diesen Methoden ist an einen bestimmten Dienst gebunden. Quelle der Allowlist: `src/bridge/allowlist.ts`. Der WebView-Teil für Audio und Dateien: `src/services/webviewExtras.ts`.

## net.fetch

`OpenScrBridge.net.fetch(url, options)`

Die Anfrage läuft in React Native, nicht im Seitenursprung. Dadurch gilt CORS hier nicht. Erlaubt sind nur `http:` und `https:`. Die Kategorie ist `http`, dieselbe Zustimmung wie `http.fetch`. Deshalb bleibt die Methode auf iOS, wo HTTP schon erlaubt ist. Roh-Sockets (`net.tcp*`, `net.udp*`) bleiben auf iOS aus.

| Option | Bedeutung |
| --- | --- |
| `method` | HTTP-Methode, Voreinstellung `GET` |
| `headers` | bis 40 Einträge |
| `body` | Text, höchstens 200000 Zeichen |
| `bodyBase64` | Binärkörper |
| `timeoutMs` | 1 bis 60000, Voreinstellung 20000 |
| `binary` | Antwort als ein Base64-String |
| `chunked` | Antwort als Base64-Stücke zu 48 KiB |

Antwort: `{ ok, status, headers, encoding, body?, chunks?, byteLength }`. `encoding` ist `text`, `base64` oder `base64-chunks`. Die Antwort darf höchstens 1,5 MiB sein. Mehr als 20 Aufrufe in 10 Sekunden werden abgelehnt.

Im Browser-Gast gibt es diese native Anfrage nicht.

## audio und files

Nur Android und Web. Auf iOS werden die Funktionen nicht in die Seite eingesetzt.

```javascript
const picked = await OpenScrBridge.files.pickAudio({ accept: ['audio/mpeg'], multiple: true });
// [{ name, mime, bytes: Uint8Array, durationMs }]
// Kein dauerhafter Pfad. Die WebView öffnet die Dateiauswahl.

const clip = await OpenScrBridge.audio.cut({
  bytes: picked[0].bytes,
  startMs: 30000,
  durationMs: 10000,
  targetBytes: 180000
});
// clip.bytes: Uint8Array, Kopf "MULW" + Rate + Dauer, dann 16 kHz mono mu-law.
// 10 Sekunden ohne targetBytes: 160012 Bytes.

await OpenScrBridge.audio.schedulePlay({ bytes: clip.bytes, startAtMs: Date.now() + 700, durationMs: 10000 });
await OpenScrBridge.audio.stop();
const clock = await OpenScrBridge.clock.sync();
// clock.now() ist die lokale Uhr. Kein nativer Bluetooth-Scheduler.
```

`audio.cut` dekodiert in der WebView mit `AudioContext`. Das ist JavaScript und über ein Update auslieferbar. `audio.speak` antwortet mit dem Hinweis, dass Sprachausgabe ein natives Modul braucht. `schedulePlay` startet über `AudioContext` zur angegebenen `Date.now()`-Zeit. Eine Toleranz von 100 ms inklusive Bluetooth-Puffer ist damit nicht garantiert. Dafür wäre ein nativer Player nötig. Ein neuer EAS-Build ist für den jetzigen Stand nicht nötig.

## multiplayer.sendBinary

Nur Android, Web-Host und Browser-Gäste. Auf iOS bleibt die Kategorie `multiplayer` aus.

```javascript
await OpenScrBridge.multiplayer.sendBinary({ to: playerId, bytes: clip.bytes, id: 'c3' });
const stop = OpenScrBridge.multiplayer.onBinary((message) => {
  // message.bytes ist Uint8Array, message.id, message.from
});
OpenScrBridge.multiplayer.onBinaryProgress((progress) => {
  // progress.received, progress.total, progress.id
});
```

Ohne `to` geht das Paket an alle anderen im Raum. Die Nutzlast darf 256 KiB groß sein, also über der Grenze von 32 KiB für `multiplayer.send`. Stücke zu 12000 Bytes laufen als Rahmen `bin`. Der Empfänger setzt sie wieder zusammen. Fortschritt kommt als `multiplayer.binaryProgress`, das fertige Paket als `multiplayer.binary`. Pro Übertragung zählt eine Spielnachricht. Zusätzlich gelten höchstens 1 MiB Binärdaten in 10 Sekunden und derselbe Deckel von 80 Nachrichten in 10 Sekunden für den ersten Stückwechsel einer Übertragung.

`multiplayer.send` bleibt bei 32 KiB.

## songHistory

Gemeinsame Liste zuletzt gespielter Titel auf diesem Gerät. Sie liegt im Host unter `@openscr_song_history` (AsyncStorage), nicht im Speicher einer einzelnen OpenScrapp. `songraten.history.v1` von Song raten bleibt deren eigene Allzeit-Statistik und wird hier nicht gelesen. Add-ons laufen in derselben WebView und sehen `OpenScrBridge.songHistory` mit.

Der Host setzt `source` auf die App-Id der laufenden OpenScrapp und `sourceName` auf ihren Anzeigenamen. Felder dafür vom Aufrufer werden verworfen. `playedAt` ist der Zeitpunkt des Aufrufs in Millisekunden. Titel und Künstler werden bereinigt und auf 200 Zeichen gekürzt. Dieselbe Kombination aus normalisiertem Titel, Künstler und Quelle aktualisiert nur `playedAt`. Höchstens 200 Einträge. Beim Lesen und Schreiben fallen Einträge weg, die älter als 24 Stunden sind. Mitternacht löscht nichts.

`songHistory.add` ist auf 30 Aufrufe pro Minute und OpenScrapp begrenzt. Die Kategorie `songHistory` braucht keine Zustimmung und keinen Eintrag in `openscr.json`. Sie gilt auch auf iOS.

| Methode | Rückgabe |
| --- | --- |
| `songHistory.add({ title, artist? })` | `{ ok: true }` |
| `songHistory.list({ source?, excludeSelf?, sinceMs? })` | Einträge, neueste zuerst |
| `songHistory.sources()` | `[{ source, sourceName, count }]` der letzten 24 Stunden |
| `songHistory.clear()` | `{ ok: true }`, nur die Einträge der aufrufenden OpenScrapp |

`source` in `list` trifft wie `targetScrapp` bei Add-ons: App-Id, `owner/repo`, Repository-Name oder Anzeigename, nach derselben Normalisierung. `excludeSelf: true` lässt die eigene OpenScrapp weg. `sinceMs` engt das Fenster ein. Älter als 24 Stunden liefert es nichts.

Ein Eintrag ist `{ title, artist?, source, sourceName, playedAt }`.

### Beispiel für Song raten und Imposter Dance

```javascript
const bridge = window.OpenScrBridge;

// Nachdem ein Song wirklich gespielt wurde:
await bridge.songHistory.add({ title: track.name, artist: track.artist });

// Im Suchfeld: Knopf nur, wenn die andere OpenScrapp Titel hat.
async function recentSongButtons(searchInput) {
  const box = document.querySelector('#recent-songs');
  box.textContent = '';
  const sources = await bridge.songHistory.sources();
  const songs = await bridge.songHistory.list({ excludeSelf: true });
  for (const row of sources) {
    const fromThere = songs.filter((entry) => entry.source === row.source);
    if (!fromThere.length) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Songs aus ' + row.sourceName;
    button.addEventListener('click', () => {
      const pick = fromThere[0];
      searchInput.value = pick.artist ? pick.title + ' ' + pick.artist : pick.title;
      searchInput.dispatchEvent(new Event('input'));
    });
    box.appendChild(button);
  }
}
```
