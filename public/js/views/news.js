// Neu & bald sowie Top 10 pro Genre
import { S } from "../state.js";
import { COUNTRIES, H } from "../constants.js";
import { $, esc, iso, fmtDate, num, yearOf } from "../util.js";
import { tmdb, saReady, saChanges, SA, nowPlaying } from "../api.js";
import { saCatalogs, isSaved, genreMap } from "../data.js";
import { cardHTML, decorate, fskLimit } from "../cards.js";
import { register } from "../router.js";
import { segInit, provParams, fskParams } from "./discover.js";

/* ---------- Neu & bald ---------- */
async function renderNew(){
  const box = $("n-box"), C = COUNTRIES[S.country];
  const cats = saCatalogs(), hasSA = saReady() && cats.length > 0;
  $("n-de-wrap").hidden = !hasSA;
  const secs = [];
  if (hasSA) secs.push(
    ["new", "Neu in deinen Diensten", "Seit kurzem im Abo verfügbar", () => saRail("new", cats)],
    ["expiring", "Letzte Chance", "Verlässt bald einen deiner Dienste. Titel auf deinen Listen stehen vorne.", () => saRail("expiring", cats)],
    ["upcoming", "Bald in deinen Diensten", "Angekündigte Neuzugänge", () => saRail("upcoming", cats)]);
  secs.push(
    ["tnm", "Neu als Stream oder Download", `Filme, die in den letzten Wochen in ${C} digital erschienen sind`,
      () => tmdbRail("movie", {region: S.country, with_release_type: "4", "release_date.gte": iso(-45), "release_date.lte": iso(0), sort_by: "popularity.desc"})],
    ["tnt", "Neue Serien", `Kürzlich gestartet und in ${C} verfügbar`,
      () => tmdbRail("tv", {watch_region: S.country, with_watch_monetization_types: "flatrate|free|ads", "first_air_date.gte": iso(-45), "first_air_date.lte": iso(0), sort_by: "popularity.desc"})],
    ["kino", "Jetzt im Kino", `Läuft gerade in den Kinos in ${C}. In den Details findest du Vorstellungen.`, async () => (await nowPlaying()).slice(0, 20).map(x => cardHTML({...x, media_type: "movie"}, {chip: {kind: "soon", text: "Im Kino"}})).join("")],
    ["tum", "Bald im Kino und als Stream", "Filme der nächsten drei Monate",
      () => tmdbRail("movie", {region: S.country, with_release_type: "2|3|4", "release_date.gte": iso(1), "release_date.lte": iso(90), sort_by: "popularity.desc"}, true)],
    ["tut", "Neue Serien demnächst", "Starten in den nächsten drei Monaten",
      () => tmdbRail("tv", {"first_air_date.gte": iso(1), "first_air_date.lte": iso(90), sort_by: "popularity.desc"}, true)]);
  const hint = SA.needsLink ? `<p class="hint">Verbinde dieses Gerät unter <a href="#einstellungen">Einstellungen → Geräte synchronisieren</a>, dann siehst du hier auch, was neu in deinen Diensten ist und was bald ausläuft.</p>`
    : !saReady() ? `<p class="hint">Mit Streaming Availability (Einstellungen) siehst du hier zusätzlich, was neu in deinen Diensten ist und was bald ausläuft.</p>`
    : !S.mine.length ? `<p class="hint">Wähle in den <a href="#einstellungen">Einstellungen</a> deine Dienste, dann siehst du hier auch „Neu in deinen Diensten“ und „Letzte Chance“.</p>`
    : !hasSA ? `<p class="hint">Für deine gewählten Dienste liefert Streaming Availability keine Änderungsdaten.</p>` : "";
  box.innerHTML = hint + secs.map(([id, t, s]) => `<section class="section" aria-labelledby="nh-${id}"><h2 class="sec" id="nh-${id}">${t}</h2><p class="sub">${s}</p><div class="rail" id="nr-${id}"><p class="empty">Lade …</p></div></section>`).join("");
  for (const [id, , , fn] of secs){
    fn().then(html => {
      const el = $("nr-" + id); if (!el) return;
      el.innerHTML = html || `<p class="empty">Gerade nichts gefunden.</p>`;
      decorate(el);
    }).catch(e => {
      const el = $("nr-" + id); if (!el) return;
      if (e.message === "off") el.parentElement.remove(); else el.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    });
  }
}
async function tmdbRail(type, params, upcoming){
  const d = await tmdb(`/discover/${type}`, {include_adult: "false", ...params}, 6 * H);
  return d.results.slice(0, 20).map(x => {
    const date = x.release_date || x.first_air_date;
    const chip = upcoming ? {kind: "soon", text: date && date > iso(0) ? "ab " + fmtDate(date) : "Bald"} : null;
    return cardHTML({...x, media_type: type}, chip ? {chip} : {});
  }).join("");
}
function hasGerman(sh, c){
  const opts = (sh.streamingOptions || {})[S.country.toLowerCase()];
  if (!opts) return true;
  const auds = opts.filter(o => o.service?.id === c.service?.id).flatMap(o => o.audios || []).map(a => a.language);
  return !auds.length || auds.includes("deu");
}
async function saRail(kind, cats){
  const d = await saChanges(kind, cats); if (!d) return "";
  const de = $("n-de").checked, seen = new Set(), out = [];
  for (const c of d.changes || []){
    const sh = (d.shows || {})[c.showId];
    if (!sh || seen.has(c.showId)) continue;
    const [t, i] = String(sh.tmdbId || "").split("/");
    if (!t || !i) continue;
    if (de && !hasGerman(sh, c)) continue;
    seen.add(c.showId);
    const type = t === "tv" ? "tv" : "movie", svc = c.service?.name || "", date = c.timestamp ? fmtDate(c.timestamp) : "";
    const text = kind === "new" ? `Neu bei ${svc}` : kind === "expiring" ? `${svc} · bis ${date || "bald"}` : `${svc} · ab ${date || "bald"}`;
    out.push({it: {media_type: type, id: +i, title: sh.title, posterUrl: sh.imageSet?.verticalPoster?.w240 || null, year: sh.releaseYear || sh.firstAirYear},
      chip: {kind: kind === "expiring" ? "pay" : kind === "new" ? "mine" : "soon", text}, saved: isSaved(type + ":" + i)});
  }
  if (kind === "expiring") out.sort((a, b) => b.saved - a.saved);
  return out.slice(0, 30).map(x => cardHTML(x.it, {chip: x.chip})).join("");
}
$("n-de").addEventListener("change", renderNew);
register("neu", renderNew);

/* ---------- Top 10 ---------- */
const T = {type: "movie", genre: ""};
async function renderTop(){
  const gm = await genreMap(T.type).catch(() => new Map());
  if (T.genre && !gm.has(+T.genre)) T.genre = "";
  $("t-genres").innerHTML = [["", "Alle"], ...gm].map(([id, n]) => `<button type="button" data-g="${id}" aria-pressed="${String(id) === String(T.genre)}">${esc(n)}</button>`).join("");
  const gname = T.genre ? gm.get(+T.genre) : "";
  $("t-title").textContent = `Top 10 ${T.type === "tv" ? "Serien" : "Filme"}${gname ? " · " + gname : ""}`;
  const mine = $("t-mine").checked && S.mine.length;
  $("t-sub").textContent = `Gerade am beliebtesten in ${COUNTRIES[S.country]}${mine ? ", nur in deinen Diensten" : ""}`;
  $("t-list").innerHTML = `<p class="empty">Lade …</p>`;
  const p = {watch_region: S.country, sort_by: "popularity.desc", include_adult: "false", "vote_count.gte": 30,
    with_watch_monetization_types: "flatrate|free|ads|rent|buy"};
  if (T.genre) p.with_genres = T.genre;
  if (mine) provParams(p, "mine");
  fskParams(p, T.type, $("t-fsk").value);
  try {
    // Zwei Seiten holen, falls bei Serien wegen der Altersgrenze Titel wegfallen
    const d = await tmdb(`/discover/${T.type}`, p, 3 * H);
    const list = d.results.slice(0, T.type === "tv" && fskLimit($("t-fsk").value).limit !== null ? 20 : 10);
    $("t-list").innerHTML = list.length ? list.map((x, i) => cardHTML({...x, media_type: T.type}, {row: true, rank: i + 1,
      meta: [yearOf(x), x.vote_average ? "★ " + num(x.vote_average) : "", (x.genre_ids || []).slice(0, 2).map(g => gm.get(g)).filter(Boolean).join(", ")].filter(Boolean).join(" · ")})).join("")
      : `<p class="empty">Keine Titel in diesem Genre gefunden.</p>`;
    await decorate($("t-list"), {fsk: $("t-fsk").value});
    // Nach dem Ausblenden neu durchnummerieren und auf 10 kürzen
    let r = 0;
    for (const c of $("t-list").querySelectorAll(".card")){
      if (c.hidden) continue;
      if (++r > 10){ c.hidden = true; continue }
      const rk = c.querySelector(".rank"); rk.textContent = r; rk.setAttribute("aria-label", "Platz " + r);
    }
  } catch(e){ $("t-list").innerHTML = `<p class="empty">${esc(e.message)}</p>` }
}
segInit("t-seg", t => { T.type = t; T.genre = ""; renderTop() });
$("t-genres").addEventListener("click", e => { const b = e.target.closest("[data-g]"); if (b){ T.genre = b.dataset.g; renderTop() } });
$("t-mine").addEventListener("change", renderTop);
$("t-fsk").addEventListener("change", renderTop);
register("top", renderTop);
