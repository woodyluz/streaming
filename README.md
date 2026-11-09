# Streamfinder

Deine eigene JustWatch-Alternative: zeigt live, wo Filme und Serien streamen.
Daten: JustWatch über TMDB (kostenlos), optional Streaming Availability (direkte Links, Ablaufdaten)
und OMDb (IMDb, Rotten Tomatoes, Metacritic).

## Funktionen

- **Entdecken** mit Filtern für Typ, Anbieter, Genre, Jahr, Bewertung, Altersfreigabe und Sortierung
- **Suche** nach Titeln, Schauspielern, Regie und Autoren, mit Personenseiten
- **Neu & bald**: neu als Stream, neue Serien, bald im Kino und als Stream. Mit Streaming Availability zusätzlich
  *Neu in deinen Diensten*, *Letzte Chance* und *Bald in deinen Diensten*
- **Serien-Kalender**: neue Folgen der Serien, denen du folgst, mit Datum und Anbieter, ungesehene Folgen, Export als Kalenderdatei
- **Top 10** pro Genre, mit Altersfilter
- **Für dich**: begründete Empfehlungen („Weil du X mochtest: gleiche Regie, mit Y …“), Titel ähnlich zu „Nicht mein Fall“ werden abgewertet.
  Dazu **Was schaue ich heute?**
- **Listen**: mehrere Listen, sortieren nach Hinzufügen, Verfügbarkeit, Bewertung, Dauer, Jahr, Titel; filtern nach Typ, Genre, deinen Diensten
- **Profile** für mehrere Personen, je mit eigener Altersgrenze
- **Statistik**: Gesehen pro Monat, Genres, Personen und **Welcher Dienst lohnt sich?** mit Preis pro Titel
- **Import** aus IMDb, Letterboxd und Titellisten (z. B. aus JustWatch kopiert), **Export** als Sicherung (JSON) oder CSV
- **Sync** zwischen allen Geräten und **Push-Mitteilungen**, auch bei geschlossener App
- Bedienbar per Tastatur und Screenreader, hell und dunkel, als App installierbar

## Aufbau

```
public/            Die Seite (wird von Cloudflare ausgeliefert)
  index.html       Gerüst
  css/app.css      Gestaltung
  js/              Logik in Modulen (state, api, cache, merge, sync, …)
  js/views/        Ansichten (Entdecken, Kalender, Statistik, Einstellungen, …)
  config.js        Adresse deines Workers
worker/worker.js   Proxy, Sync, Push und täglicher Check
wrangler.jsonc     Cloudflare-Einstellungen
tests/unit/        Tests der Logik und des Workers (node:test)
tests/e2e/         Tests im Browser (Playwright) mit nachgebautem Worker
.github/workflows/ Automatische Tests bei jedem Update
```

## Aktualisieren von Version 4

1. Auf GitHub alle neuen Dateien und Ordner hochladen (*Add file → Upload files*, den **Inhalt** des Ordners hineinziehen).
2. Die alten Dateien im Hauptordner werden nicht mehr gebraucht und können gelöscht werden:
   `index.html`, `sw.js`, `config.js`, `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`.
   Die Seite liegt jetzt im Ordner `public/`.
3. Die Datei `.github/workflows/tests.yml` ist auf dem Mac versteckt (Punkt am Anfang).
   Entweder im Finder mit **Cmd + Shift + .** sichtbar machen und mit hochladen, oder auf GitHub
   *Add file → Create new file*, als Namen `.github/workflows/tests.yml` eintippen und den Inhalt hineinkopieren.
4. Deine Daten bleiben erhalten. Beim ersten Öffnen wird die alte Merkliste in das Profil „Ich“ übernommen.

## Cloudflare Worker (einmalig)

Im Worker unter *Einstellungen → Variablen und Secrets*:

| Name | Typ | Wert |
|---|---|---|
| `TMDB_TOKEN` | Secret | TMDB „API Read Access Token“ (der lange Token) |
| `SYNC_SECRET` | Secret | ein selbst gewähltes Passwort für Sync, Push und direkte Links |
| `SA_KEY` | Secret | optional: RapidAPI-Schlüssel für Streaming Availability |
| `OMDB_KEY` | Secret | optional: OMDb-Schlüssel |
| `ALLOWED_ORIGIN` | Text | nur nötig, wenn du die Seite zusätzlich woanders öffnest, z. B. `https://deinname.github.io` |
| `CONTACT` | Text | optional: deine E-Mail, wird Push-Diensten als Kontakt genannt |

Speicher und täglicher Zeitplan richtet `wrangler.jsonc` automatisch ein.

### Zugriffsschutz

- TMDB-Abfragen beantwortet der Worker nur für deine eigene Seite oder mit Sync-Passwort.
- Streaming Availability und OMDb nur für **verbundene Geräte** (mit Sync-Passwort), damit niemand dein Kontingent aufbraucht.
- Sync und Push immer nur mit Sync-Passwort.

Verbinde deshalb jedes Gerät einmal unter *Einstellungen → Geräte synchronisieren*.

### Deploy nur, wenn die Tests bestehen (empfohlen)

Im Worker unter *Einstellungen → Build → Build-Befehl* eintragen:

```
npm run test:unit
```

Schlägt ein Test fehl, veröffentlicht Cloudflare die neue Version nicht. Die ausführlichen Browser-Tests laufen
zusätzlich auf GitHub (Reiter *Actions*), ein grüner Haken heisst: alles in Ordnung.

## Tests lokal ausführen

```
npm install
npx playwright install chromium
npm test
```

`npm start` startet die Seite mit Testdaten unter http://localhost:4173, ganz ohne Schlüssel.

## Import

- **IMDb**: *Deine Merkliste* oder *Deine Bewertungen* → Export als CSV. Bewertungen ab 7 werden „Gefällt mir“, bis 4 „Nicht mein Fall“.
- **Letterboxd**: *Settings → Import & Export → Export your data*, im ZIP `watchlist.csv`, `watched.csv` oder `ratings.csv` wählen.
- **JustWatch** bietet keinen Export. Merkliste öffnen, Titel markieren, kopieren, im Import-Fenster einfügen.
  Zeilen, die kein Titel sind, werden übersprungen.

## Grenzen

- Altersfreigaben stammen aus TMDB (FSK für Deutschland). Für Titel ohne Angabe gilt: in Profilen mit Altersgrenze ausgeblendet, sonst angezeigt.
- Der tägliche Check prüft pro Lauf bis zu 25 Listentitel und 10 Serien, bei mehr reihum.
- „Letzte Chance“ und „Neu in deinen Diensten“ gibt es nur für Dienste, die Streaming Availability kennt.
- Quellenangaben für JustWatch, TMDB, Movie of the Night und OMDb stehen im Footer und müssen bleiben.
