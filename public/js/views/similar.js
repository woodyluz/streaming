// Ähnliches finden: eigene Funktion neben „Für dich“. Ausgangspunkt sind gewählte Titel oder die bestbewerteten Titel.
import { S, P, on } from "../state.js";
import { COUNTRIES, H } from "../constants.js";
import { $, esc, titleOf, yearOf, pool } from "../util.js";
import { tmdb, titleFull, regions } from "../api.js";
import { posterHTML } from "../posters.js";
import { statusOf, remember, listCount } from "../data.js";
import { scoreCandidates, reasonsFor } from "../recommend.js";
import { register, current } from "../router.js";

const st = {mode: "picked", picked: new Map(), result: null, autorun: false};
const keyOf = x => (x.media_type || x.type) + ":" + x.id;

// Ausgangstitel: bestbewertete zuerst (ab 4 Sternen), sonst „Gefällt mir“
function topSeeds(){
  const W = Object.values(P().watched).filter(w => w.type && w.id);
  const rated = W.filter(w => (w.stars || 0) >= 4).sort((a, b) => b.stars - a.stars || b.t - a.t);
  const liked = W.filter(w => w.like === 1 && !(w.stars >= 4)).sort((a, b) => b.t - a.t);
  return rated.concat(liked).slice(0, 8).map(w => ({key: w.key, type: w.type, id: w.id, title: w.title, how: "picked"}));
}
const seedsNow = () => st.mode === "top" ? topSeeds() : [...st.picked.values()].map(s => ({...s, how: "picked"}));

async function compute(){
  const seeds = seedsNow();
  if (!seeds.length) return {seeds, recs: []};
  const seedFull = new Map(), seedRecs = [], likedGenres = new Map();
  await pool(seeds, 4, async s => {
    try {
      const f = await titleFull(s.type, s.id);
      seedFull.set(s.key, f); seedRecs.push({seed: s, recs: f.recs});
      for (const g of f.genres) likedGenres.set(g.id, (likedGenres.get(g.id) || 0) + 1);
    } catch(e){}
  });
  const exclude = new Set(seeds.map(s => s.key));
  if ($("a-hide").checked) for (const k of Object.keys(P().watched)) exclude.add(k);
  const ranked = scoreCandidates({seedRecs, exclude, likedGenres}).slice(0, 20);
  const reg = await regions(ranked.map(c => ({type: c.r.media_type, id: c.r.id}))).catch(() => new Map());
  for (const c of ranked){ const r = reg.get(c.key); if (r !== undefined) c.st = statusOf(r) }
  const best = ranked.slice(0, 12);
  await pool(best, 4, async c => { try { c.full = await titleFull(c.r.media_type, c.r.id) } catch(e){} });
  for (const c of best) c.reasons = reasonsFor(c, c.full, seedFull, {countryName: COUNTRIES[S.country], status: c.st});
  return {seeds, recs: best};
}

function draw(){
  document.querySelectorAll("#a-mode [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === st.mode)));
  $("a-picker").hidden = st.mode !== "picked";
  const seeds = seedsNow();
  $("a-seeds").innerHTML = seeds.map(s => st.mode === "picked"
    ? `<button type="button" data-unpick="${esc(s.key)}" aria-label="${esc(s.title)} entfernen">${esc(s.title)} ✕</button>`
    : `<span>${esc(s.title)}</span>`).join("");
  $("a-go").disabled = !seeds.length;
  $("a-hint").textContent = seeds.length ? "" : st.mode === "top"
    ? "Noch keine Favoriten. Vergib in den Details Sterne (ab 4 Sternen zählt ein Titel) oder markiere Titel mit „Gefällt mir“."
    : "Suche oben einen oder mehrere Titel, zu denen du Ähnliches finden möchtest.";
  const r = st.result;
  if (!r){ $("sim-status").textContent = ""; $("a-list").innerHTML = ""; return }
  $("sim-status").textContent = r.recs.length ? `${r.recs.length} Vorschläge` : "Nichts Passendes gefunden. Nimm einen weiteren Titel dazu oder zeige auch Gesehenes.";
  $("a-list").innerHTML = r.recs.map(c => {
    const key = remember(c.r), n = listCount(key);
    return `<article class="reco" data-key="${key}" aria-labelledby="ah-${c.r.id}">
      ${posterHTML(c.r.poster_path, {title: titleOf(c.r), key})}
      <div><p class="why">${esc(c.reasons.why.replace("ausgewählt hast", "gewählt hast"))}</p>
      <h3 id="ah-${c.r.id}">${esc(titleOf(c.r))} <span class="sub" style="font-family:var(--body);font-size:13px">${c.r.media_type === "tv" ? "Serie" : "Film"}${yearOf(c.r) ? " · " + yearOf(c.r) : ""}</span></h3>
      <ul>${c.reasons.list.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="row"><button type="button" data-open="${key}">Details</button><button type="button" data-pick="${key}" class="${n ? "" : "primary"}">${n ? "Gemerkt" : "Merken"}</button></div></div></article>`;
  }).join("");
}

async function run(){
  $("sim-status").textContent = "Suche Ähnliches …"; $("a-list").innerHTML = "";
  try { st.result = await compute() } catch(e){ st.result = null; $("sim-status").textContent = e.message; return }
  draw();
}

let sTimer = 0, sSeq = 0;
$("a-q").addEventListener("input", () => {
  clearTimeout(sTimer);
  const q = $("a-q").value.trim();
  if (q.length < 2){ $("a-sugg").innerHTML = ""; return }
  sTimer = setTimeout(async () => {
    const seq = ++sSeq;
    try {
      const d = await tmdb("/search/multi", {query: q, include_adult: "false"}, H);
      if (seq !== sSeq) return;
      const list = d.results.filter(x => x.media_type === "movie" || x.media_type === "tv").slice(0, 6);
      $("a-sugg").innerHTML = list.map(x => `<button type="button" data-add="${x.media_type}:${x.id}" data-t="${esc(titleOf(x))}">${esc(titleOf(x))}${yearOf(x) ? " (" + yearOf(x) + ")" : ""}${x.media_type === "tv" ? " · Serie" : ""}</button>`).join("") || `<span class="sub">Keine Treffer</span>`;
    } catch(e){ $("a-sugg").innerHTML = "" }
  }, 300);
});
$("a-sugg").addEventListener("click", e => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const [type, id] = b.dataset.add.split(":");
  st.picked.set(b.dataset.add, {key: b.dataset.add, type, id: +id, title: b.dataset.t});
  $("a-q").value = ""; $("a-sugg").innerHTML = ""; st.result = null; draw();
});
$("a-seeds").addEventListener("click", e => {
  const b = e.target.closest("[data-unpick]"); if (!b) return;
  st.picked.delete(b.dataset.unpick); st.result = null; draw();
});
$("a-mode").addEventListener("click", e => {
  const b = e.target.closest("[data-mode]"); if (!b || b.dataset.mode === st.mode) return;
  st.mode = b.dataset.mode; st.result = null; draw();
});
$("a-hide").addEventListener("change", () => { if (st.result) run() });
$("a-go").addEventListener("click", run);

// „Ähnliche finden“ aus der Detailansicht
on("similar", it => {
  st.picked.set(it.key, it); st.mode = "picked"; st.result = null; st.autorun = true;
  if (current() === "aehnlich") render(); else location.hash = "#aehnlich";
});
on("profile", () => { st.result = null });
function render(o){
  draw();
  if (st.autorun){ st.autorun = false; run() }
}
register("aehnlich", render);
