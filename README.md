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

### Neu in Version 6

- **Abo-Planer** (Reiter *Planer*): ein Dienst pro Monat, gewählt nach deinen Listen, Serien, Ablaufdaten und Preisen.
  Zeigt Gratis-Titel, was du wann schauen kannst, was du sparst und welche Abos du kündigen kannst
- **Reise-Modus** (Reiter *Planer*): was aus deinen Listen am Reiseziel läuft
- **Filmabend**: Abstimmung mit Link für Freunde und Familie, alle wischen ja oder nein, der erste gemeinsame Treffer gewinnt
- **Wonach ist dir?** (Reiter *Für dich*): Suche in eigenen Worten, z. B. „etwas Spannendes unter 2 Stunden, nicht zu brutal“
- **Listen teilen** als Leselink, den jede Person ohne Konto öffnen kann
- **Gemeinsam bearbeiten**: Unter *Listen → Gemeinsam bearbeiten* bekommst du einen Link. Alle damit können anonym Titel hinzufügen
  und entfernen, auch ohne Sync-Passwort. Gäste sehen nur diese eine Liste und die ganze Filmauswahl, nie deine anderen Listen.
  *Gemeinsames Bearbeiten beenden* macht den Link ungültig
- **Sterne und Notizen** statt nur „Gefällt mir“, **Jahresrückblick** in der Statistik
- **Preiswächter**: meldet, wenn ein Titel günstiger wird oder in deinem Abo landet
- **Jetzt im Kino** mit Link zu Vorstellungen in deiner Stadt
- **Kinderschutz-PIN**, **Spoiler-Schutz** pro Profil, **Wischgesten** am Handy (rechts merken, links gesehen)
- **Schweizer Angebote** zuerst, **Originaltitel** unter dem deutschen Titel, fehlende Poster werden automatisch nachgeladen
- **Automatische Sicherung** jede Woche, mit Zurückholen in den Einstellungen
- **Trakt-Abgleich** für „Gesehen“ und Serien-Stand
- Klarer Hinweis, wenn Streamfinder unter der falschen Adresse geöffnet ist

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

## Aktualisieren

Von Version 5: alle Dateien hochladen und ersetzen, Daten bleiben erhalten. `wrangler.jsonc` ist unverändert.

### Von Version 4

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
| `ANTHROPIC_API_KEY` | Secret | optional: Stimmungssuche mit KI (siehe unten) |
| `TRAKT_CLIENT_ID` | Secret | optional: Trakt-Abgleich (siehe unten) |
| `TRAKT_CLIENT_SECRET` | Secret | optional: Trakt-Abgleich |

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

## Optionale Dienste

**Stimmungssuche mit KI.** Ohne Schlüssel versteht Streamfinder rund 40 Stichworte auf Deutsch („spannend“, „lustig“,
„nicht zu brutal“, „unter 2 Stunden“, „aus den 90ern“, „Geheimtipp“ …). Mit einem Schlüssel von https://console.anthropic.com
versteht es freie Sätze besser. Das kostet pro Suche einen Bruchteil eines Rappens; der Worker begrenzt auf 300 Suchen pro Tag.

**Trakt.** Auf https://trakt.tv/oauth/applications eine App anlegen, als Redirect-URI `urn:ietf:wg:oauth:2.0:oob` eintragen,
Client-ID und Client-Secret als Secrets im Worker speichern. Danach in Streamfinder *Einstellungen → Trakt → Mit Trakt verbinden*.
Streamfinder gleicht beim Öffnen höchstens alle 12 Stunden automatisch ab.

**Filmabend und geteilte Listen** brauchen keinen weiteren Dienst. Erstellen geht nur auf verbundenen Geräten,
mitmachen und ansehen kann jede Person mit dem Link. Abstimmungen laufen sieben Tage.

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

- **Kino:** Es gibt keine frei nutzbare Quelle für Schweizer Kinoprogramme. Streamfinder zeigt, was laut TMDB im Kino läuft,
  und verlinkt für die Vorstellungen eine Websuche mit deiner Stadt.
- **Abo-Planer:** Ablaufdaten kommen von Streaming Availability und werden nur für die ersten 15 Titel abgefragt, um das Kontingent zu schonen.
  Ohne eingetragene Preise rechnet der Planer mit einem Durchschnittspreis.
- **Schweizer Angebote** erscheinen nur, wenn TMDB sie für die Schweiz kennt.

- Altersfreigaben stammen aus TMDB (FSK für Deutschland). Für Titel ohne Angabe gilt: in Profilen mit Altersgrenze ausgeblendet, sonst angezeigt.
- Der tägliche Check prüft pro Lauf bis zu 25 Listentitel und 10 Serien, bei mehr reihum.
- „Letzte Chance“ und „Neu in deinen Diensten“ gibt es nur für Dienste, die Streaming Availability kennt.
- Quellenangaben für JustWatch, TMDB, Movie of the Night und OMDb stehen im Footer und müssen bleiben.
