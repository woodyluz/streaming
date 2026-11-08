# Streamfinder

Eine eigene JustWatch-Alternative: zeigt live, wo Filme und Serien streamen.
Die Daten stammen von JustWatch und werden über die kostenlose TMDB-API abgefragt.

## Funktionen

- Suche während des Tippens, Entdecken mit Filtern (Typ, Anbieter, Genre, Jahr, Bewertung, Sortierung)
- **Meine Dienste**: deine Abos werden überall grün hervorgehoben
- **Merkliste** mit Mitteilung, sobald ein Titel neu in einem deiner Dienste verfügbar ist
- Ländervergleich in den Details, Trailer-Link
- Zwischenspeicher (TMDB-Antworten mehrere Stunden, Poster im Service Worker)
- Als App installierbar (PWA), funktioniert auch offline für bereits geladene Inhalte

## Auf GitHub Pages veröffentlichen

1. Auf github.com ein neues **öffentliches** Repository anlegen, z. B. `streamfinder`.
2. Alle Dateien aus diesem Ordner hochladen (*Add file → Upload files*). Den Ordner `worker/` brauchst du dort nicht.
3. *Settings → Pages* öffnen, bei **Source** „Deploy from a branch“ wählen, Branch `main`, Ordner `/ (root)`, speichern.
4. Nach etwa einer Minute ist die Seite unter `https://DEINNAME.github.io/streamfinder/` erreichbar.
5. Beim ersten Öffnen deinen TMDB-Schlüssel eintragen (siehe unten).

Auf dem Handy: Seite öffnen → *Teilen → Zum Home-Bildschirm* (iPhone) bzw. *Installieren* (Android).
Mitteilungen funktionieren auf dem iPhone nur in der installierten App.

## TMDB-Schlüssel

1. Konto auf https://www.themoviedb.org anlegen.
2. Unter *Einstellungen → API* einen Schlüssel beantragen (kostenlos, nicht-kommerziell).
3. Den „API-Schlüssel“ oder das „Lesezugriffstoken“ in Streamfinder einfügen.

Der Schlüssel wird nur im Browser gespeichert, nicht im Repository. Er ist aber für jeden sichtbar,
der Zugriff auf diesen Browser hat. Wenn du die Seite mit anderen teilen willst, nimm den Proxy.

## Optional: Proxy mit Cloudflare Worker

So bleibt der Schlüssel geheim, und andere können deine Seite ohne eigenen Schlüssel nutzen.

1. Kostenloses Konto auf https://dash.cloudflare.com anlegen.
2. *Workers & Pages → Erstellen → Worker* → Namen vergeben → *Bereitstellen*.
3. *Code bearbeiten*, den Inhalt von `worker/worker.js` einfügen, *Bereitstellen*.
4. *Einstellungen → Variablen*:
   - `TMDB_TOKEN` als **Secret**: dein TMDB-Lesezugriffstoken (der lange Token)
   - `ALLOWED_ORIGIN`: `https://DEINNAME.github.io`
5. Die Worker-Adresse (z. B. `https://streamfinder.deinname.workers.dev`) in Streamfinder unter
   *Einstellungen → Zugang → Proxy* eintragen.

## Grenzen

- TMDB liefert keine Preise, keine direkten Links zum Titel beim Anbieter und keine Ablaufdaten.
- Mitteilungen werden geprüft, wenn du die App öffnest, nicht im Hintergrund.
- Pflicht: JustWatch und TMDB als Quelle nennen (steht bereits im Footer).
