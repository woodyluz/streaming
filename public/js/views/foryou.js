// Für dich: Zufallsvorschlag und begründete Empfehlungen
import { S, P, on } from "../state.js";
import { COUNTRIES, IMG, H } from "../constants.js";
import { $, esc, num, short, titleOf, yearOf, pool } from "../util.js";
import { tmdb, titleFull, regionOf, regions, certOf, workerApi } from "../api.js";
import { parseMood, sanitizeMood, moodParams } from "../mood.js";
import { cardHTML, decorate } from "../cards.js";
import { posterHTML } from "../posters.js";
import { statusOf, genreMap, remember, isSaved, listItems, listCount } from "../data.js";
import { fskLimit } from "../cards.js";
import { scoreCandidates, reasonsFor } from "../recommend.js";
import { register } from "../router.js";
import { segInit, fillGenres, provParams, fskParams } from "./discover.js";

/* ---------- Was schaue ich heute? ---------- */
const R = {type: "movie", shown: new Set()};
segInit("r-seg", async t => {
  R.type = t;
  await fillGenres($("r-genre"), t, "Egal welches Genre");
  const o = $("r-time").options;
  o[1].text = t === "tv" ? "Folgen bis 30 Minuten" : "bis 100 Minuten"; o[1].value = t === "tv" ? "30" : "100";
  o[2].text = t === "tv" ? "Folgen bis 60 Minuten" : "bis 130 Minuten"; o[2].value = t === "tv" ? "60" : "130";
});
async function fskOk(type, id){
  const {limit, strict} = fskLimit($("r-fsk").value);
  if (limit === null) return true;
  const n = await certOf(type, id).catch(() => null);
  return n === null ? !strict : n <= limit;
}
async function surprise(){
  const out = $("r-out");
  out.innerHTML = `<p class="status" style="margin-top:14px">Suche etwas Passendes …</p>`;
  const p = {watch_region: S.country, sort_by: "popularity.desc", include_adult: "false", "vote_average.gte": 6.5, "vote_count.gte": R.type === "tv" ? 150 : 300};
  provParams(p, S.mine.length ? "mine" : "all");
  if (!S.mine.length) p.with_watch_monetization_types = "flatrate|free|ads";
  fskParams(p, R.type, $("r-fsk").value);
  if ($("r-genre").value) p.with_genres = $("r-genre").value;
  if ($("r-time").value) p["with_runtime.lte"] = $("r-time").value;
  try {
    const first = await tmdb(`/discover/${R.type}`, {...p, page: 1}, 6 * H);
    if (!first.results.length){ out.innerHTML = `<p class="status" style="margin-top:14px">Nichts gefunden. Lockere Genre, Dauer oder Altersfreigabe.</p>`; return }
    let x = null;
    for (let tries = 0; tries < 4 && !x; tries++){
      const page = 1 + Math.floor(Math.random() * Math.min(first.total_pages, 12));
      const d = page === 1 ? first : await tmdb(`/discover/${R.type}`, {...p, page}, 6 * H);
      const cands = d.results.filter(r => !P().watched[R.type + ":" + r.id] && !R.shown.has(r.id)).sort(() => Math.random() - .5);
      for (const c of cands.slice(0, 5)) if (await fskOk(R.type, c.id)){ x = c; break }
    }
    if (!x){ R.shown.clear(); out.innerHTML = `<p class="status" style="margin-top:14px">Gerade nichts Neues gefunden. Versuch es noch einmal oder lockere die Filter.</p>`; return }
    R.shown.add(x.id);
    const [gm, st] = await Promise.all([genreMap(R.type).catch(() => new Map()), regionOf(R.type, x.id).then(statusOf).catch(() => null)]);
    const key = remember({...x, media_type: R.type});
    const why = [x.vote_average >= 7.5 ? `Sehr gut bewertet: ${num(x.vote_average)} von 10` : `Gut bewertet: ${num(x.vote_average)} von 10`,
      st && st.kind === "mine" ? `Ohne Zusatzkosten bei ${st.names.join(", ")}` : st ? st.text : "",
      (x.genre_ids || []).slice(0, 3).map(g => gm.get(g)).filter(Boolean).join(", ")].filter(Boolean);
    const n = listCount(key);
    out.innerHTML = `<div class="big">
      ${posterHTML(x.poster_path, {title: titleOf(x), key})}
      <div><h3>${esc(titleOf(x))}</h3><p class="sub">${R.type === "tv" ? "Serie" : "Film"}${yearOf(x) ? " · " + yearOf(x) : ""}</p>
      <ul>${why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      ${x.overview ? `<p>${esc(short(x.overview, 280))}</p>` : ""}
      <div class="row"><button class="primary" type="button" data-open="${key}">Details</button>
      <button type="button" data-pick="${key}" class="${n ? "" : ""}">${n ? "Gemerkt" : "Merken"}</button>
      <button type="button" id="r-again">Noch einer</button></div></div></div>`;
    $("r-again").onclick = surprise;
  } catch(e){ out.innerHTML = `<p class="status" style="margin-top:14px">${esc(e.message)}</p>` }
}
$("r-go").addEventListener("click", surprise);

/* ---------- Empfehlungen ---------- */
let recsCache = null;
on("watched", () => { recsCache = null });
on("profile", () => { recsCache = null; R.shown.clear(); $("r-out").innerHTML = "" });
on("settings", () => { recsCache = null });
on("synced", () => { recsCache = null });

async function buildRecs(){
  const W = Object.values(P().watched).filter(w => w.type && w.id);
  let seeds = W.filter(w => w.like === 1).sort((a, b) => b.t - a.t).slice(0, 5).map(w => ({...w, how: "liked"}));
  if (seeds.length < 4) seeds = seeds.concat(W.filter(w => w.like !== -1 && !seeds.some(s => s.key === w.key)).sort((a, b) => b.t - a.t).slice(0, 4 - seeds.length).map(w => ({...w, how: "seen"})));
  if (seeds.length < 4) seeds = seeds.concat(listItems().filter(i => !seeds.some(s => s.key === i.key)).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 4 - seeds.length).map(i => ({...i, how: "list"})));
  if (!seeds.length) return {seeds, recs: []};
  const dislikedW = W.filter(w => w.like === -1).sort((a, b) => b.t - a.t).slice(0, 5);
  const seedFull = new Map(), seedRecs = [], disliked = [], likedGenres = new Map();
  await pool([...seeds, ...dislikedW.map(w => ({...w, bad: true}))], 4, async s => {
    try {
      const f = await titleFull(s.type, s.id);
      if (s.bad) disliked.push({key: s.key, recs: f.recs, genres: f.genres.map(g => g.id)});
      else {
        seedFull.set(s.key, f); seedRecs.push({seed: s, recs: f.recs});
        if (s.how === "liked") for (const g of f.genres) likedGenres.set(g.id, (likedGenres.get(g.id) || 0) + 1);
      }
    } catch(e){}
  });
  const exclude = new Set([...Object.keys(P().watched), ...listItems().map(i => i.key)]);
  const ranked = scoreCandidates({seedRecs, disliked, exclude, likedGenres}).slice(0, 16);
  const reg = await regions(ranked.map(c => ({type: c.r.media_type, id: c.r.id}))).catch(() => new Map());
  for (const c of ranked){
    const r = reg.get(c.key);
    if (r !== undefined){ c.st = statusOf(r); if (c.st.kind === "mine") c.score += 4; else if (c.st.kind === "none") c.score -= 3 }
  }
  ranked.sort((a, b) => b.score - a.score);
  const {limit, strict} = fskLimit("");
  const best = [];
  for (const c of ranked){
    if (best.length >= 8) break;
    if (limit !== null){ const n = await certOf(c.r.media_type, c.r.id).catch(() => null); if (n === null ? strict : n > limit) continue }
    best.push(c);
  }
  await pool(best, 4, async c => { try { c.full = await titleFull(c.r.media_type, c.r.id) } catch(e){} });
  for (const c of best) c.reasons = reasonsFor(c, c.full, seedFull, {countryName: COUNTRIES[S.country], status: c.st});
  return {seeds, recs: best, disliked: disliked.length};
}
function drawRecs({seeds, recs, disliked}){
  if (!seeds.length){
    $("e-status").textContent = "";
    $("e-list").innerHTML = `<p class="hint">Markiere in den Details Titel als „Gesehen“ und „Gefällt mir“ oder setze sie auf eine Liste. Dann empfehle ich dir hier passende Titel mit Begründung.</p>`;
    return;
  }
  $("e-status").textContent = recs.length
    ? `Ausgehend von ${seeds.map(s => "„" + s.title + "“").join(", ")}${disliked ? `. Ähnliches wie deine ${disliked} „Nicht mein Fall“-Titel wird abgewertet.` : ""}`
    : "Gerade keine neuen Empfehlungen gefunden.";
  $("e-list").innerHTML = recs.map(c => {
    const key = remember(c.r), n = listCount(key);
    return `<article class="reco" data-key="${key}" aria-labelledby="rh-${c.r.id}">
      ${posterHTML(c.r.poster_path, {title: titleOf(c.r), key})}
      <div><p class="why">${esc(c.reasons.why)}</p>
      <h3 id="rh-${c.r.id}">${esc(titleOf(c.r))} <span class="sub" style="font-family:var(--body);font-size:13px">${c.r.media_type === "tv" ? "Serie" : "Film"}${yearOf(c.r) ? " · " + yearOf(c.r) : ""}</span></h3>
      <ul>${c.reasons.list.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
      <div class="row"><button type="button" data-open="${key}">Details</button><button type="button" data-pick="${key}" class="${n ? "" : "primary"}">${n ? "Gemerkt" : "Merken"}</button></div></div></article>`;
  }).join("");
}
async function renderForYou(o){
  if (!$("r-genre").options[1]) fillGenres($("r-genre"), R.type, "Egal welches Genre");
  if (recsCache && !o?.force){ drawRecs(recsCache); return }
  $("e-status").textContent = "Suche Empfehlungen …"; $("e-list").innerHTML = "";
  try { recsCache = await buildRecs(); drawRecs(recsCache) }
  catch(e){ $("e-status").textContent = e.message }
}
$("e-refresh").addEventListener("click", () => renderForYou({force: true}));
register("fuerdich", renderForYou);

/* ---------- Wonach ist dir? ---------- */
async function moodSearch(text){
  const out = $("m-out");
  out.innerHTML = `<p class="status" style="margin-top:12px">Ich suche passende Titel …</p>`;
  let f = null, via = "Stichworte";
  if (S.proxy){
    try { f = sanitizeMood((await workerApi("/api/mood", {method: "POST", body: {text}})).filters); via = "KI" } catch(e){ f = null }
  }
  if (!f || (!f.understood.length && !f.genres.movie.length && !f.genres.tv.length)) { f = parseMood(text); via = "Stichworte" }
  const {limit} = fskLimit("");
  if (limit !== null) f.fskMax = f.fskMax === null ? limit : Math.min(f.fskMax, limit);
  const types = f.type ? [f.type] : ["movie", "tv"];
  try {
    const lists = await Promise.all(types.map(async t => {
      const p = {...moodParams(f, t), watch_region: S.country, include_adult: "false"};
      provParams(p, S.mine.length ? "mine" : "all");
      if (!S.mine.length) p.with_watch_monetization_types = "flatrate|free|ads";
      const d = await tmdb(`/discover/${t}`, p, 6 * H);
      return d.results.filter(x => !P().watched[t + ":" + x.id]).map(x => ({...x, media_type: t}));
    }));
    const merged = [];
    for (let i = 0; merged.length < 16 && lists.some(l => l[i]); i++) for (const l of lists) if (l[i] && merged.length < 16) merged.push(l[i]);
    const chips = f.understood.map(u => `<span>${esc(u)}</span>`).join("");
    out.innerHTML = `${chips ? `<div class="understood" aria-label="Verstanden">${chips}</div>` : ""}
      ${f.notes.map(n => `<p class="sub">${esc(n)}</p>`).join("")}
      <p class="sub">${merged.length ? `${merged.length} Vorschläge${S.mine.length ? " aus deinen Diensten" : ""}` : "Nichts gefunden. Formuliere es etwas offener."}${via === "KI" ? " · verstanden mit KI" : ""}</p>
      <div class="grid" id="m-grid">${merged.map(x => cardHTML(x)).join("")}</div>`;
    decorate($("m-grid"), {fsk: f.fskMax ?? ""});
  } catch(e){ out.innerHTML = `<p class="status" style="margin-top:12px">${esc(e.message)}</p>` }
}
$("m-form").addEventListener("submit", e => { e.preventDefault(); const t = $("m-text").value.trim(); if (t) moodSearch(t) });
