# Add-ons

Ein Add-on ist ein GitHub-Repository mit `addon.json` und JavaScript. OpenScr lädt es in den Entwicklereinstellungen, speichert es auf dem Gerät und setzt es ein, wenn die passende OpenScrapp startet. Das passiert nach dem Code der OpenScrapp. Danach feuert die Seite `openscr:addon`.

Add-ons gibt es auf Android und in der Web-Entwicklungsumgebung. Auf iOS ist `addonsAvailable` in `src/services/iosPolicy.ts` falsch. Dort gibt es keine Oberfläche, keinen Download und kein eingesetztes Skript.

## addon.json

```json
{
  "id": "dance-tools",
  "name": "Dance Tools",
  "version": "1.0.0",
  "icon": "♪",
  "targetScrapp": "owner/ImposterDanceScrapp",
  "minScrappVersion": "1.0.0",
  "entry": "main.js"
}
```

`targetScrapp` trifft die OpenScrapp, wenn der Wert die App-Id, `owner/repo`, der Repository-Name oder der Name aus `openscr.json` ist. Groß- und Kleinschreibung spielt keine Rolle. `minScrappVersion` wird mit `manifest.version` verglichen. Ist die OpenScrapp älter, läuft ihr Code weiter und das Add-on liefert eine kopierbare Fehlermeldung.

`entry` ist ein relativer Pfad auf eine `.js`-Datei. Weitere JavaScript-Dateien im Repository werden davor, in sortierter Reihenfolge, eingesetzt. Höchstens 24 Dateien, 256 KiB pro Datei, 1 MiB insgesamt.

## Oberfläche

In den Entwicklereinstellungen: Repository-URL hinzufügen, jedes Add-on ein- oder ausschalten. Ein optionales GitHub-Token liegt in der sicheren Ablage (`expo-secure-store`, Schlüssel `openscr_addon_gh_token`). Es wird nicht geloggt. Es geht nur an `api.github.com` und `raw.githubusercontent.com` für dieses Add-on-Repository. Fehlt die sichere Ablage, wird kein Token gespeichert.

Unten in der laufenden OpenScrapp zeigt eine Leiste das `icon` jedes aktiven Add-ons für diese OpenScrapp.

## Ereignis

```javascript
window.addEventListener('openscr:addon', (event) => {
  // event.detail.loaded: [{ id, name, version, icon }]
  // event.detail.errors: [{ id, name, message }]
});
```

Ein Fehler in einer Add-on-Datei landet in `window.__openscrAddonErrors` und bricht die OpenScrapp nicht ab.
