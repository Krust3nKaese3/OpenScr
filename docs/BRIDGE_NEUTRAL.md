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
