# Add-ons

Ein Add-on ist ein GitHub-Repository mit `addon.json` und JavaScript. OpenScr lädt es in den Entwicklereinstellungen, speichert es auf dem Gerät und setzt es ein, wenn die passende OpenScrapp startet. Das passiert nach dem Code der OpenScrapp. Danach feuert die Seite `openscr:addon`.

Add-ons gibt es auf Android, auf iOS und in der Web-Entwicklungsumgebung. Android nimmt jedes GitHub-Repository an und zeigt den Hinweis zur Eigenverantwortung. Auf iOS ist `addonsRequireOwnRepo` wahr: URL-Besitzer und `owner.login` müssen das angemeldete Konto sein, beim Hinzufügen, bei jedem Update und bei jedem Öffnen. Organisationen und fremde Repositories werden abgelehnt, ohne Ausnahme. Das Add-on darf nur eine OpenScrapp treffen, die selbst so installiert ist. Der Quelltext liegt nur lesbar unter „Quelltext“.

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

`targetScrapp` trifft die OpenScrapp, wenn der Wert nach derselben Normalisierung einem dieser Texte gleicht: der App-Id, `owner/repo`, dem Repository-Namen oder dem Anzeigenamen (`name` aus `openscr.json`). Die Normalisierung trimmt, schreibt klein, ersetzt Leerzeichen und Unterstriche durch `-` und zieht aufeinanderfolgende Bindestriche zu einem zusammen. `imposter-dance` trifft damit `Imposter Dance` und `imposter_dance`. `ImposterDanceScrapp` trifft das Repository `ImposterDanceScrapp`. Dieselbe Funktion gilt beim Hinzufügen, beim Update, beim Einsetzen und bei den Zeichen auf der Karte. `minScrappVersion` wird mit `manifest.version` verglichen. Ist die OpenScrapp älter, läuft ihr Code weiter und das Add-on liefert eine kopierbare Fehlermeldung.

`entry` ist ein relativer Pfad auf eine `.js`-Datei. Weitere JavaScript-Dateien im Repository werden davor, in sortierter Reihenfolge, eingesetzt. Höchstens 24 Dateien, 256 KiB pro Datei, 1 MiB insgesamt.

## Wofür das da ist

Ein Add-on ist Code zum Lernen und Ausprobieren: eigener Code oder Code von Dritten, der nach dem Start einer bestimmten OpenScrapp läuft. OpenScr prüft den Inhalt nicht. Die Fläche auf der Karte sagt das in einem fest sichtbaren Hinweis. Beim ersten Hinzufügen muss dieser Hinweis einmal bestätigt werden.

## Nutzerfluss

Jede OpenScrapp-Karte in der Bibliothek hat unten rechts eine kleine Add-on-Schaltfläche, auch auf iOS. Links daneben stehen die Zeichen der eingeschalteten Add-ons für diese OpenScrapp, höchstens drei, danach `+N`.

Die Schaltfläche öffnet ein Blatt von unten:

- ein Feld für die GitHub-URL und **Hinzufügen**. Dabei werden `addon.json`, `targetScrapp` (muss diese OpenScrapp treffen) und `minScrappVersion` geprüft. Die Fehlermeldung lässt sich kopieren.
- die Zeile **Privates Repo? Token hinterlegen**. Das Token nutzt dieselbe sichere Ablage wie bisher.
- die Liste der Add-ons dieser OpenScrapp: Zeichen, Name, Version, Schalter, **Update**, **Entfernen**.

Auf iOS prüft **Hinzufügen** und **Update** zusätzlich den Besitzer. „Quelltext“ zeigt die Add-on-Dateien unter `addon/` nur zum Lesen. Die Leiste der laufenden OpenScrapp bleibt „Entwicklungsumgebung · eigener Code“.

## Oberfläche

In den Entwicklereinstellungen bleibt die allgemeine Liste: Repository-URL hinzufügen, jedes Add-on ein- oder ausschalten. Dieselbe Bestätigung des Hinweises gilt dort beim ersten Mal. Ein optionales GitHub-Token liegt in der sicheren Ablage (`expo-secure-store`, Schlüssel `openscr_addon_gh_token`). Es wird nicht geloggt. Es geht nur an `api.github.com` und `raw.githubusercontent.com` für dieses Add-on-Repository. Fehlt die sichere Ablage, wird kein Token gespeichert.

Unten in der laufenden OpenScrapp zeigt eine Leiste das `icon` jedes aktiven Add-ons für diese OpenScrapp.

## Ereignis

```javascript
window.addEventListener('openscr:addon', (event) => {
  // event.detail.loaded: [{ id, name, version, icon }]
  // event.detail.errors: [{ id, name, message }]
});
```

Ein Fehler in einer Add-on-Datei landet in `window.__openscrAddonErrors` und bricht die OpenScrapp nicht ab.
