// Entdecken, Suche und Personenseiten
import { S, on } from "../state.js";
import { COUNTRIES, DEPT, IMG, H } from "../constants.js";
import { $, esc, iso, fmtDate, short, yearOf } from "../util.js";
import { tmdb, personFull } from "../api.js";
import { providerList, genreMap } from "../data.js";
import { cardHTML, personHTML, decorate, fskLimit } from "../cards.js";
import { register } from "../router.js";

export function segInit(id, onPick){
  for (const b of $(id).querySelectorAll("button")) b.addEventListener("click", () => {
    for (const x of $(id).querySelectorAll("button")) x.setAttribute("aria-pressed", x === b);
    onPick(b.dataset.type);
  });
}
export async function fillGenres(sel, type, first){
  const cur = sel.value;
  sel.innerHTML = `<option value="">${first}</option>`;
  try { for (const [id, name] of await genreMap(type)) sel.add(new Option(name, id)) } catch(e){}
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
export function provParams(p, pv){
  const ids = pv === "all" ? [] : pv === "mine" ? S.mine : [pv];
  if (ids.length){ p.with_watch_providers = ids.join("|"); p.with_watch_monetization_types = "flatrate|free|ads" }
  return p;
}
// Altersgrenze für Film-Abfragen direkt bei TMDB setzen (Serien werden danach gefiltert)
export function fskParams(p, type, sel){
  const {limit} = fskLimit(sel);
  if (type === "movie" && limit !== null){ p.certification_country = "DE"; p["certification.lte"] = limit }
  return p;
}

/* ---------- Entdecken ---------- */
const D = {type: "movie", page: 1, total: 1, dirty: true, seq: 0};
export async function fillFilters(){
  const prov = $("f-prov"), cur = prov.value;
  prov.innerHTML = "";
  if (S.mine.length) prov.add(new Option("Meine Dienste", "mine"));
  prov.add(new Option("Alle Anbieter", "all"));
  try { for (const p of (await providerList()).slice(0, 25)) prov.add(new Option(p.provider_name, p.provider_id)) } catch(e){}
  prov.value = [...prov.options].some(o => o.value === cur) ? cur : (S.mine.length ? "mine" : "all");
  await fillGenres($("f-genre"), D.type, "Alle Genres");
}
async function loadDiscover(append){
  const seq = ++D.seq;
  D.dirty = false;
  if (!append){ D.page = 1; $("d-grid").innerHTML = "" }
  $("d-status").textContent = "Lade …"; $("d-more").hidden = true;
  const tv = D.type === "tv", dk = tv ? "first_air_date" : "primary_release_date";
  const p = {watch_region: S.country, page: D.page, include_adult: "false", sort_by: $("f-sort").value};
  if (p.sort_by === "new"){ p.sort_by = dk + ".desc"; p[dk + ".lte"] = iso(0); p["vote_count.gte"] = 5 }
  if (p.sort_by === "vote_average.desc") p["vote_count.gte"] = 300;
  const pv = $("f-prov").value;
  provParams(p, pv);
  fskParams(p, D.type, $("f-fsk").value);
  if ($("f-genre").value) p.with_genres = $("f-genre").value;
  if ($("f-year").value) p[dk + ".gte"] = $("f-year").value + "-01-01";
  if ($("f-rating").value){ p["vote_average.gte"] = $("f-rating").value; p["vote_count.gte"] = Math.max(p["vote_count.gte"] || 0, 100) }
  try {
    const d = await tmdb(`/discover/${D.type}`, p, H);
    if (seq !== D.seq) return;
    D.total = d.total_pages;
    $("d-grid").insertAdjacentHTML("beforeend", d.results.map(x => cardHTML({...x, media_type: D.type})).join(""));
    const where = pv === "all" ? "" : pv === "mine" ? " in deinen Diensten" : " bei " + $("f-prov").selectedOptions[0].text;
    $("d-status").textContent = d.total_results
      ? `${d.total_results.toLocaleString("de-CH")} ${tv ? "Serien" : "Filme"}${where} · ${COUNTRIES[S.country]}`
      : "Keine Treffer. Lockere die Filter etwas.";
    $("d-more").hidden = D.page >= D.total;
    decorate($("d-grid"), {fsk: $("f-fsk").value});
  } catch(e){ if (seq === D.seq) $("d-status").textContent = e.message }
}
segInit("d-seg", async t => { D.type = t; await fillGenres($("f-genre"), t, "Alle Genres"); loadDiscover(false) });
for (const id of ["f-prov", "f-genre", "f-year", "f-rating", "f-sort", "f-fsk"]) $(id).addEventListener("change", () => loadDiscover(false));
$("d-more").addEventListener("click", () => { D.page++; loadDiscover(true) });
register("entdecken", o => { if (D.dirty || o?.refresh) loadDiscover(false) });
for (const ev of ["settings", "profile", "synced"]) on(ev, () => { D.dirty = true });

/* ---------- Suche ---------- */
let sTimer, sSeq = 0;
$("q").addEventListener("input", () => {
  clearTimeout(sTimer);
  sTimer = setTimeout(() => {
    const q = $("q").value.trim();
    if (q.length < 2){ if (location.hash === "#suche") location.hash = "entdecken"; return }
    location.hash === "#suche" ? runSearch() : (location.hash = "suche");
  }, 350);
});
$("q").addEventListener("keydown", e => { if (e.key === "Enter"){ clearTimeout(sTimer); $("q").dispatchEvent(new Event("input")) } });
const deptName = d => DEPT[d] || "";
async function runSearch(){
  const q = $("q").value.trim(), seq = ++sSeq;
  $("s-label").textContent = `Ergebnisse für „${q}“`;
  $("s-status").textContent = "Suche …";
  try {
    const d = await tmdb("/search/multi", {query: q, include_adult: "false"}, H);
    if (seq !== sSeq) return;
    const people = d.results.filter(x => x.media_type === "person" && (x.popularity > 0.5 || x.profile_path)).slice(0, 10);
    $("s-people").innerHTML = people.map(p => personHTML({...p, sub: deptName(p.known_for_department)})).join("");
    $("s-people-wrap").hidden = !people.length;
    const list = d.results.filter(x => x.media_type === "movie" || x.media_type === "tv");
    $("s-grid").innerHTML = list.map(x => cardHTML(x)).join("");
    $("s-status").textContent = list.length ? "" : people.length ? "Keine Titel gefunden. Tippe auf eine Person, um ihre Filme und Serien zu sehen." : "Keine Treffer. Versuche einen anderen Namen oder Titel.";
    applyMine();
    decorate($("s-grid"), {after: applyMine});
  } catch(e){ if (seq === sSeq) $("s-status").textContent = e.message }
}
function applyMine(){
  const on_ = $("s-mine").checked;
  const cards = [...$("s-grid").querySelectorAll(".card")];
  for (const c of cards) c.hidden = c.dataset.blocked === "1" || (on_ && !!c.dataset.done && c.dataset.kind !== "mine");
  if (on_ && !S.mine.length) $("s-status").innerHTML = `Wähle zuerst deine Dienste in den <a href="#einstellungen">Einstellungen</a>.`;
  else if (on_ && cards.length && cards.every(c => c.dataset.done)){
    const n = cards.filter(c => !c.hidden).length;
    $("s-status").textContent = n ? `${n} Treffer in deinen Diensten` : "Keiner dieser Treffer ist in deinen Diensten.";
  }
}
$("s-mine").addEventListener("change", applyMine);
register("suche", () => runSearch());

/* ---------- Person ---------- */
const PS = {data: null, tab: "cast", all: false};
async function loadPerson(id){
  $("p-head").innerHTML = `<p class="status">Lade …</p>`; $("p-grid").innerHTML = ""; $("p-tabs").innerHTML = ""; $("p-more").hidden = true;
  try {
    const p = await personFull(id);
    PS.data = p; PS.all = false;
    PS.tab = p.dept === "Acting" || !p.crew.length ? "cast" : "crew";
    if (!p.cast.length) PS.tab = "crew";
    const life = [p.birthday ? "Geboren " + fmtDate(p.birthday, true) : "", p.place || "", p.deathday ? "Gestorben " + fmtDate(p.deathday, true) : ""].filter(Boolean).join(" · ");
    $("p-head").innerHTML = `<div class="phead">
      <span class="poster" aria-hidden="true" style="${p.profile_path ? `background-image:url(${IMG}w342${p.profile_path})` : ""}"></span>
      <div><h2>${esc(p.name)}</h2><p>${esc(deptName(p.dept) || p.dept || "")}</p>${life ? `<p>${esc(life)}</p>` : ""}
      ${p.bio ? `<p class="bio">${esc(short(p.bio, 600))}</p>` : ""}</div></div>`;
    $("p-tabs").innerHTML = [["cast", "Vor der Kamera", p.cast.length], ["crew", "Hinter der Kamera", p.crew.length]]
      .filter(x => x[2]).map(([k, l, n]) => `<button type="button" data-ptab="${k}" aria-pressed="${k === PS.tab}">${l}<span>${n}</span></button>`).join("");
    renderPersonGrid();
  } catch(e){ $("p-head").innerHTML = `<p class="status">${esc(e.message)}</p>` }
}
function renderPersonGrid(){
  const list = PS.data[PS.tab], shown = PS.all ? list : list.slice(0, 40);
  $("p-grid").innerHTML = shown.map(x => cardHTML(x, {meta: [x.media_type === "tv" ? "Serie" : "Film", yearOf(x), x.role].filter(Boolean).join(" · ")})).join("");
  $("p-more").hidden = PS.all || list.length <= 40;
  decorate($("p-grid"));
}
$("p-tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-ptab]"); if (!b) return;
  PS.tab = b.dataset.ptab; PS.all = false;
  for (const x of $("p-tabs").children) x.setAttribute("aria-pressed", x === b);
  renderPersonGrid();
});
$("p-more").addEventListener("click", () => { PS.all = true; renderPersonGrid() });
register("person", id => { if (id && typeof id !== "object") loadPerson(id) });
