// Import aus Dateien oder eingefügten Titeln, Sicherung als JSON
import { S, P, SYNC_FIELDS, save, emit, touch } from "../state.js";
import { $, esc, pool, download, toast } from "../util.js";
import { tmdb } from "../api.js";
import { remember, setInList, newList, isSaved, inList, ITEMS } from "../data.js";
import { toQueries, pickResult } from "../importers.js";
import { starsFromRating, likeFromStars } from "../stats.js";
import { mergeAll } from "../merge.js";
import { openModal, closeModal } from "../a11y.js";

let running = false, cancel = false;

function fillTargets(){
  const sel = $("imp-target");
  sel.innerHTML = P().lists.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("") + `<option value="__new">Neue Liste „Import“</option>`;
  sel.value = (S.curList[S.profile] && P().lists.some(l => l.id === S.curList[S.profile])) ? S.curList[S.profile] : P().lists[0].id;
}
export function openImport(){
  fillTargets();
  $("imp-status").textContent = ""; $("imp-prog").hidden = true; $("imp-go").disabled = false;
  openModal($("imp"), {focus: () => $("imp-file"), onClose: () => { cancel = true }});
}

async function find(q){
  if (q.imdb){
    const d = await tmdb(`/find/${q.imdb}`, {external_source: "imdb_id"}, 168 * 3600e3);
    const r = (q.type === "tv" ? d.tv_results : d.movie_results)?.[0] || d.movie_results?.[0] || d.tv_results?.[0];
    if (r) return {...r, media_type: r.media_type || (d.tv_results?.includes(r) ? "tv" : "movie")};
  }
  if (!q.title) return null;
  const path = q.type === "movie" ? "/search/movie" : q.type === "tv" ? "/search/tv" : "/search/multi";
  const params = {query: q.title, include_adult: "false"};
  if (q.year && q.type === "movie") params.primary_release_year = q.year;
  if (q.year && q.type === "tv") params.first_air_date_year = q.year;
  let d = await tmdb(path, params, 168 * 3600e3);
  let r = pickResult(q, d.results.map(x => ({...x, media_type: x.media_type || q.type})));
  if (!r && q.year && q.type){ d = await tmdb(path, {query: q.title, include_adult: "false"}, 168 * 3600e3); r = pickResult(q, d.results.map(x => ({...x, media_type: x.media_type || q.type}))) }
  return r;
}

async function run(){
  if (running) return;
  const file = $("imp-file").files[0];
  const text = file ? await file.text() : $("imp-text").value;
  const parsed = toQueries(text, file?.name || "");
  if (parsed.format === "backup") return importBackup(parsed.data);
  if (!parsed.items.length){ $("imp-status").textContent = "Keine Titel erkannt. Prüfe die Datei oder füge Titel ein, einen pro Zeile."; return }
  let target = $("imp-target").value;
  if (target === "__new") target = newList("Import").id;
  running = true; cancel = false;
  $("imp-go").disabled = true; $("imp-prog").hidden = false; $("imp-prog").max = parsed.items.length; $("imp-prog").value = 0;
  const label = {"imdb-list": "IMDb-Liste", "imdb-ratings": "IMDb-Bewertungen", "lb-list": "Letterboxd-Merkliste", "lb-watched": "Letterboxd „Gesehen“",
    "lb-ratings": "Letterboxd-Bewertungen", generic: "CSV-Datei", titles: "Titelliste"}[parsed.format] || "Datei";
  let done = 0, added = 0, watched = 0, already = 0;
  const missing = [], errors = new Map();
  await pool(parsed.items, 4, async q => {
    if (cancel) return;
    try {
      const r = await find(q);
      if (!r){ missing.push(q.title || q.imdb); return }
      const key = remember(r);
      if (q.watched){
        const pd = P();
        if (!pd.watched[key]){
          const t = q.date && !isNaN(Date.parse(q.date)) ? Date.parse(q.date) : Date.now();
          const it = {...ITEMS.get(key)};
          const st = starsFromRating(q.rating);
          pd.watched[key] = {...it, t, stars: st, like: likeFromStars(st)};
          watched++;
        } else already++;
      } else {
        const l = P().lists.find(x => x.id === target);
        if (l && !inList(l, key)){ setInList(target, key, true); added++ } else already++;
      }
    } catch(e){ errors.set(e.message, (errors.get(e.message) || 0) + 1); missing.push(q.title || q.imdb) }
    finally { done++; $("imp-prog").value = done; $("imp-status").textContent = `${label}: ${done} von ${parsed.items.length} geprüft …` }
  });
  touch(); emit("watched"); emit("saved");
  running = false; $("imp-go").disabled = false;
  const parts = [];
  if (added) parts.push(`${added} auf die Liste gesetzt`);
  if (watched) parts.push(`${watched} als gesehen übernommen`);
  if (already) parts.push(`${already} waren schon da`);
  $("imp-status").innerHTML = esc(`${label}: ${parts.join(", ") || "nichts übernommen"}.`) +
    (missing.length ? `<br>${missing.length} nicht gefunden: ${esc(missing.slice(0, 12).join(", "))}${missing.length > 12 ? " …" : ""}` : "") +
    (errors.size ? `<br><b>Grund:</b> ${esc([...errors].map(([m, n]) => `${m} (${n}×)`).join(" · "))}` : "");
  toast("Import abgeschlossen");
}

function importBackup(data){
  const local = {};
  for (const f of SYNC_FIELDS) local[f] = S[f];
  const m = mergeAll(local, data);
  for (const f of SYNC_FIELDS) S[f] = m[f];
  for (const f of SYNC_FIELDS) save(f);
  S.setT = Date.now(); save("setT");
  emit("dirty", "pdata"); emit("synced");
  const n = m.profiles.reduce((a, p) => a + m.pdata[p.id].lists.reduce((b, l) => b + l.items.length, 0), 0);
  $("imp-status").textContent = `Sicherung übernommen und mit deinen Daten zusammengeführt: ${m.profiles.length} Profile, ${n} Listeneinträge.`;
  toast("Sicherung übernommen");
}

export function exportBackup(){
  const data = {};
  for (const f of SYNC_FIELDS) data[f] = S[f];
  const stamp = new Date().toISOString().slice(0, 10);
  download(`streamfinder-sicherung-${stamp}.json`, JSON.stringify({app: "streamfinder", v: 2, exported: new Date().toISOString(), data}, null, 1), "application/json");
  toast("Sicherung heruntergeladen");
}

$("imp-go").addEventListener("click", run);
$("imp-close").addEventListener("click", () => closeModal($("imp")));
$("imp").addEventListener("click", e => { if (e.target.id === "imp") closeModal($("imp")) });
document.addEventListener("click", e => { if (e.target.closest("[data-import]")) openImport() });
