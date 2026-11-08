# Streamfinder

Deine eigene JustWatch-Alternative: zeigt live, wo Filme und Serien streamen.
Daten: JustWatch über TMDB (kostenlos), optional Streaming Availability (direkte Links, Ablaufdaten)
und OMDb (IMDb, Rotten Tomatoes, Metacritic).

## Funktionen

- **Entdecken** mit Filtern (Typ, Anbieter, Genre, Jahr, Bewertung, Sortierung)
- **Suche** nach Titeln, Schauspielern, Regie und Autoren, mit Personenseiten (vor und hinter der Kamera)
- **Neu & bald**: neu als Stream, neue Serien, bald im Kino und als Stream, neue Serien demnächst.
  Mit Streaming Availability zusätzlich: *Neu in deinen Diensten*, *Letzte Chance*, *Bald in deinen Diensten*, Filter „nur mit deutscher Tonspur“
- **Top 10** pro Genre, für Filme und Serien, optional nur deine Dienste
- **Für dich**: Empfehlungen mit Begründung („Weil du X mochtest: gleiche Regie, mit Y, ebenfalls Drama …“)
  und **Was schaue ich heute?** (Zufallsvorschlag nach Genre und Dauer)
- **Mehrere Listen** (anlegen, umbenennen, löschen), **Gesehen** mit „Gefällt mir“, **Serien-Fortschritt**
- **Meine Dienste** werden überall grün hervorgehoben
- Details: Besetzung, Regie/Drehbuch, Trailer, Ähnliche Titel, Ländervergleich, Teilen,
  direkte Links mit Preisen, Ablaufdatum, Tonspuren und Untertiteln, IMDb- und Rotten-Tomatoes-Werte
- **Sync** zwischen allen Geräten und **Push-Mitteilungen** (neu in deinen Diensten, letzte Chance), auch bei geschlossener App
- Hell/Dunkel-Umschalter, als App installierbar

## 1. Auf GitHub Pages veröffentlichen

1. Repository **öffentlich** machen (*Settings → General → Danger Zone → Change visibility*).
2. Alle Dateien aus diesem Ordner hochladen (*Add file → Upload files*), gleichnamige werden ersetzt.
   Den Ordner `worker/` brauchst du dort nicht.
3. *Settings → Pages*: Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
4. Die Seite läuft unter `https://DEINNAME.github.io/REPONAME/`.

Ohne weitere Schritte fragt die Seite nach dem TMDB-Schlüssel und speichert ihn im Browser.
Für Sync, Push und „nie wieder etwas eingeben“ richte den Worker ein:

## 2. Cloudflare Worker einrichten (kostenlos, ca. 15 Minuten)

1. Konto auf https://dash.cloudflare.com anlegen.
2. **Speicher anlegen:** *Storage & Databases → KV → Create* → Name `streamfinder`.
3. **Worker anlegen:** *Workers & Pages → Erstellen → Worker* → Name `streamfinder` → *Bereitstellen*.
4. *Code bearbeiten* → gesamten Inhalt von `worker/worker.js` einfügen → *Bereitstellen*.
5. Im Worker unter *Einstellungen*:
   - **Bindungen → Hinzufügen → KV-Namespace**: Variablenname `SF_KV`, Namespace `streamfinder`
   - **Variablen und Secrets → Hinzufügen**:

     | Name | Typ | Wert |
     |---|---|---|
     | `TMDB_TOKEN` | Secret | TMDB „API Read Access Token“ (der lange Token) |
     | `SYNC_SECRET` | Secret | ein selbst gewähltes Passwort für den Geräte-Sync |
     | `SA_KEY` | Secret | optional: RapidAPI-Schlüssel für Streaming Availability |
     | `OMDB_KEY` | Secret | optional: OMDb-Schlüssel |
     | `ALLOWED_ORIGIN` | Text | `https://DEINNAME.github.io` |
     | `CONTACT` | Text | deine E-Mail (wird Push-Diensten als Kontakt genannt) |

   - **Trigger → Cron-Trigger hinzufügen**: `0 7 * * *` (täglicher Check um 08:00 Uhr Winterzeit)
6. Worker-Adresse kopieren, z. B. `https://streamfinder.deinname.workers.dev`.
7. Auf GitHub `config.js` öffnen → Stift → bei `proxy:` die Adresse eintragen → *Commit changes*.

Schreibe **niemals** Schlüssel in `config.js`. Die Datei ist öffentlich.

## 3. Geräte verbinden und Push einschalten

1. Streamfinder öffnen → *Einstellungen → Geräte synchronisieren* → `SYNC_SECRET` eingeben → *Verbinden*.
2. Weitere Geräte: dort das Passwort eingeben, oder auf dem ersten Gerät „Link für weiteres Gerät kopieren“
   und den Link auf dem anderen Gerät öffnen.
3. *Einstellungen → Mitteilungen → Push aktivieren*, dann *Test senden*.
   iPhone: Seite zuerst über *Teilen → Zum Home-Bildschirm* installieren und von dort öffnen.

Synchronisiert werden Listen, Gesehen, Serien-Fortschritt, Dienste, Land und Vergleichsländer.
Bei gleichzeitigen Änderungen auf zwei Geräten gewinnt die letzte.

## Schlüssel besorgen

- **TMDB** (kostenlos): https://www.themoviedb.org → *Einstellungen → API*.
- **Streaming Availability** (Gratis-Kontingent): https://rapidapi.com → „Streaming Availability“ (Movie of the Night)
  → *Pricing* → Basic-Plan → unter *Endpoints* `X-RapidAPI-Key` kopieren.
  Streamfinder speichert Antworten 12–24 Stunden, damit das Kontingent reicht.
- **OMDb** (kostenlos, 1000 Abfragen pro Tag): https://www.omdbapi.com/apikey.aspx

## Grenzen

- Der Push-Check prüft pro Tag bis zu 35 Titel deiner Listen, bei längeren Listen reihum.
- „Letzte Chance“ und „Neu in deinen Diensten“ gibt es nur für Dienste, die Streaming Availability kennt
  (u. a. Netflix, Prime Video, Disney+, Apple TV+, Paramount+, MUBI, WOW).
- Empfehlungen beruhen auf TMDB-Empfehlungen und werden aus Regie, Besetzung, Genre und Bewertung begründet.
- Quellenangaben für JustWatch, TMDB, Movie of the Night und OMDb stehen im Footer und müssen bleiben.
