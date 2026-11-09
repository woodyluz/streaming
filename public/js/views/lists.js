// Listen: wechseln, anlegen, umbenennen, löschen, sortieren, filtern, exportieren
import { S, P, save, on, touch } from "../state.js";
import { COUNTRIES } from "../constants.js";
import { $, esc, fmtDate, pool, toast, download } from "../util.js";
import { titleFull } from "../api.js";
import { newList, renameList, deleteList, listItems, genreMap, backfill } from "../data.js";
import { shareList, unshareList, sharedId } from "./shared.js";
import { startCollab, stopCollab, shareLink, collabLink, pull, watch } from "./collab.js";
import { syncReady } from "../sync.js";
import { cardHTML, decorate } from "../cards.js";
import { toCSV } from "../importers.js";
import { register, current } from "../router.js";

let mode = null;
const cur = () => S.curList[S.profile] || "main";
const setCur = id => { S.curList[S.profile] = id; save("curList") };

// Bewertung, Dauer und Genres für Sortieren und Filtern nachladen (lokal zwischengespeichert)
async function ensureMeta(items, need){
  const miss = items.filter(i => { const m = S.meta[i.key] || {}; return need.some(n => m[n] === undefined) });
  if (!miss.length) return;
  $("l-status").textContent = `Lade Angaben zu ${miss.length} Titeln …`;
  await pool(miss, 4, async i => {
    try {
      const f = await titleFull(i.type, i.id);
      S.meta[i.key] = {...(S.meta[i.key] || {}), va: f.vote_average || 0, rt: f.runtime || f.episode_run_time?.[0] || 0, g: f.genres.map(g => g.name), y: (f.release_date || f.first_air_date || "").slice(0, 4)};
    } catch(e){ S.meta[i.key] = {...(S.meta[i.key] || {}), va: 0, rt: 0, g: []} }
  });
  save("meta");
}
async function fillGenreFilter(){
  const sel = $("l-genre"), keep = sel.value;
  if (sel.options.length > 1) return;
  const names = new Set();
  for (const t of ["movie", "tv"]) try { for (const n of (await genreMap(t)).values()) names.add(n) } catch(e){}
  for (const n of [...names].sort((a, b) => a.localeCompare(b, "de"))) sel.add(new Option(n, n));
  sel.value = keep;
}

async function renderLists(){
  const pd = P();
  if (!pd.lists.some(l => l.id === cur()) && cur() !== "__seen") setCur(pd.lists[0].id);
  const seenN = Object.keys(pd.watched).length;
  $("l-chips").innerHTML = pd.lists.map(l => `<button type="button" data-list="${l.id}" aria-pressed="${l.id === cur()}">${esc(l.name)}<span>${l.items.length}</span></button>`).join("")
    + `<button type="button" data-list="__seen" aria-pressed="${cur() === "__seen"}">Gesehen<span>${seenN}</span></button>`
    + `<button type="button" id="l-add">+ Neue Liste</button>`;
  const list = pd.lists.find(l => l.id === cur());
  const guest = !!list?.collab && !list.own;
  // Gemeinsame Liste: Hinweis, Link, Abgleich
  const cbox = $("l-collab");
  cbox.hidden = !list?.collab;
  if (list?.collab){
    cbox.innerHTML = list.gone
      ? `Diese gemeinsame Liste wird nicht mehr geteilt. Du siehst den letzten Stand.`
      : `<b>Gemeinsame Liste.</b> Alle mit dem Link können Titel hinzufügen und entfernen, ohne Namen. ${guest ? "Weitere Titel findest du unter Entdecken, Top 10 oder mit der Suche: einfach aufs Lesezeichen tippen." : "Gäste sehen nur diese Liste, nie deine anderen."}
        <div class="linkbox"><label class="vh" for="l-cblink">Link zur gemeinsamen Liste</label><input id="l-cblink" type="text" readonly value="${esc(collabLink(list))}"><button type="button" id="l-cbshare">Link teilen</button></div>`;
    if (!list.gone) pull(list).then(changedNow => { if (changedNow && current() === "listen") renderLists() });
    watch(list);
  }
  $("l-tools").innerHTML = (list ? (guest ? `<button type="button" id="l-leave">Liste von diesem Gerät entfernen</button>` : `<button type="button" id="l-rename">Umbenennen</button>${pd.lists.length > 1 ? `<button type="button" id="l-delete">Liste löschen</button>` : ""}
      ${list.collab ? `<button type="button" id="l-cbstop">Gemeinsames Bearbeiten beenden</button>` : syncReady() ? `<button type="button" id="l-cbstart">Gemeinsam bearbeiten</button>` : ""}`)
    + (guest ? "" : `
      <button type="button" id="l-share">${sharedId(list.id) ? "Geteilten Link aktualisieren" : "Liste teilen"}</button>${sharedId(list.id) ? `<button type="button" id="l-unshare">Nicht mehr teilen</button>` : ""}
      ${list.items.length >= 2 ? `<button type="button" data-vote="l:${list.id}">Filmabend aus dieser Liste</button>` : ""}`) : "")
    + `<button type="button" data-import>Importieren</button><button type="button" id="l-export">Als CSV exportieren</button>`;
  $("l-form").hidden = !mode; $("l-confirm").hidden = true;
  fillGenreFilter();

  let items = list ? [...list.items] : Object.values(pd.watched).filter(w => w.type).sort((a, b) => b.t - a.t);
  const g = $("l-grid");
  if (!items.length){
    g.innerHTML = "";
    $("l-status").textContent = list ? "Diese Liste ist leer. Tippe bei einem Titel auf das Lesezeichen, um ihn hier zu sammeln." : "Noch nichts als gesehen markiert. Das geht in den Details.";
    return;
  }
  const sort = $("l-sort").value, type = $("l-type").value, genre = $("l-genre").value, onlyMine = $("l-mine").checked;
  const need = [];
  if (sort === "rating") need.push("va");
  if (sort === "runtime") need.push("rt");
  if (genre) need.push("g");
  if (need.length) await ensureMeta(items, need);
  if (current() !== "listen") return;
  const total = items.length;
  if (type) items = items.filter(i => i.type === type);
  if (genre) items = items.filter(i => (S.meta[i.key]?.g || []).includes(genre));
  const m = k => S.meta[k] || {};
  const sorters = {
    added: (a, b) => (b.added || b.t || 0) - (a.added || a.t || 0),
    rating: (a, b) => (m(b.key).va || 0) - (m(a.key).va || 0),
    runtime: (a, b) => (m(a.key).rt || 999) - (m(b.key).rt || 999),
    year: (a, b) => String(b.year || "").localeCompare(String(a.year || "")),
    title: (a, b) => String(a.title).localeCompare(String(b.title), "de"),
    avail: (a, b) => 0
  };
  items.sort(sorters[sort] || sorters.added);

  g.innerHTML = items.map(w => {
    const meta = m(w.key), bits = [w.type === "tv" ? "Serie" : "Film", w.year];
    if (sort === "rating" && meta.va) bits.push("★ " + meta.va.toFixed(1).replace(".", ","));
    if (sort === "runtime" && meta.rt) bits.push(meta.rt + " Min." + (w.type === "tv" ? " pro Folge" : ""));
    if (!list) bits.push("gesehen " + fmtDate(w.t) + (w.stars ? " · " + "★".repeat(w.stars) : w.like === 1 ? " · gefällt mir" : w.like === -1 ? " · nicht mein Fall" : ""));
    return cardHTML({media_type: w.type, id: w.id, title: w.title, poster_path: w.poster, posterUrl: w.posterUrl, year: w.year, orig: w.orig}, {meta: bits.filter(Boolean).join(" · ")});
  }).join("");
  const shownText = n => `${n}${n !== total ? ` von ${total}` : ""} Titel`;
  $("l-status").textContent = `${shownText(items.length)} · Verfügbarkeit in ${COUNTRIES[S.country]}`;
  const order = {mine: 0, flat: 1, pay: 2, none: 3};
  await decorate(g);
  if (current() !== "listen") return;
  const cards = [...g.children];
  if (onlyMine) for (const c of cards) if (c.dataset.kind !== "mine") c.hidden = true;
  if (sort === "avail") cards.sort((a, b) => (order[a.dataset.kind] ?? 4) - (order[b.dataset.kind] ?? 4)).forEach(c => g.appendChild(c));
  if (items.some(i => !i.poster || i.orig === undefined)) backfill(40);
  const visible = cards.filter(c => !c.hidden).length, mineN = cards.filter(c => c.dataset.kind === "mine").length;
  $("l-status").textContent = onlyMine ? `${visible} Titel in deinen Diensten` : `${shownText(visible)} · ${S.mine.length ? `${mineN} davon in deinen Diensten` : `Verfügbarkeit in ${COUNTRIES[S.country]}`}`;
}

$("l-chips").addEventListener("click", e => {
  if (e.target.closest("#l-add")){ mode = "new"; $("l-name").value = ""; renderLists().then(() => $("l-name").focus()); return }
  const b = e.target.closest("[data-list]"); if (!b) return;
  setCur(b.dataset.list); mode = null; renderLists();
});
$("l-tools").addEventListener("click", e => {
  const list = P().lists.find(l => l.id === cur());
  if (e.target.id === "l-export") return exportCSV();
  if (!list) return;
  if (e.target.id === "l-share") return shareList(list.id).then(() => renderLists());
  if (e.target.id === "l-cbstart") return startCollab(list).then(() => renderLists()).catch(err => toast(err.message));
  if (e.target.id === "l-cbstop") return stopCollab(list).then(() => renderLists());
  if (e.target.id === "l-leave"){
    const pd = P(); pd.tomb.lists[list.id] = Date.now(); pd.lists = pd.lists.filter(l => l.id !== list.id);
    if (!pd.lists.length) pd.lists.push({id: "main", name: "Merkliste", nt: 0, items: []});
    setCur(pd.lists[0].id); touch(); toast("Liste von diesem Gerät entfernt. Mit dem Link kannst du sie jederzeit wieder öffnen."); return renderLists();
  }
  if (e.target.id === "l-unshare") return unshareList(list.id).then(() => renderLists());
  if (e.target.id === "l-rename"){ mode = "rename"; $("l-form").hidden = false; $("l-name").value = list.name; $("l-name").focus() }
  if (e.target.id === "l-delete"){
    $("l-confirm").innerHTML = `<span>Liste „${esc(list.name)}“ mit ${list.items.length} Titeln löschen?</span><button type="button" class="primary" id="l-del-yes">Löschen</button><button type="button" id="l-del-no">Abbrechen</button>`;
    $("l-confirm").hidden = false; $("l-del-no").focus();
  }
});
$("l-confirm").addEventListener("click", e => {
  if (e.target.id === "l-del-yes"){ deleteList(cur()); setCur(P().lists[0].id); toast("Liste gelöscht") }
  if (e.target.id === "l-del-yes" || e.target.id === "l-del-no") renderLists();
});
$("l-form").addEventListener("submit", e => {
  e.preventDefault();
  const n = $("l-name").value.trim(); if (!n) return;
  if (mode === "new"){ const l = newList(n); setCur(l.id); toast(`Liste „${l.name}“ angelegt`) }
  else renameList(cur(), n);
  mode = null; renderLists();
});
$("l-cancel").addEventListener("click", () => { mode = null; renderLists() });
for (const id of ["l-sort", "l-type", "l-genre", "l-mine"]) $(id).addEventListener("change", renderLists);

export function exportCSV(){
  const pd = P(), list = pd.lists.find(l => l.id === cur());
  const items = list ? list.items : Object.values(pd.watched);
  const rows = [["Titel", "Jahr", "Typ", "TMDB-ID", "Hinzugefügt", "Gesehen", "Bewertung"]];
  for (const i of items){
    const w = pd.watched[i.key];
    rows.push([i.title, i.year || "", i.type === "tv" ? "Serie" : "Film", i.id, i.added ? new Date(i.added).toISOString().slice(0, 10) : "",
      w ? new Date(w.t).toISOString().slice(0, 10) : "", w?.like === 1 ? "gefällt mir" : w?.like === -1 ? "nicht mein Fall" : ""]);
  }
  const name = (list ? list.name : "Gesehen").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();
  download(`streamfinder-${name}.csv`, toCSV(rows), "text/csv");
  toast("CSV heruntergeladen");
}

register("listen", renderLists);
on("synced", () => { if (current() === "listen") renderLists() });

// Abzeichen „Neu für dich“ am Reiter
export function updateBadge(){
  const n = listItems().filter(i => S.track[i.key]?.n).length;
  $("badge").hidden = !n; $("badge").textContent = n;
  $("badge").setAttribute("aria-label", `${n} neu verfügbar`);
}
on("saved", () => { updateBadge(); if (current() === "listen") renderLists() });
on("profile", updateBadge);
on("backfilled", () => { if (current() === "listen") renderLists() });
on("collabChanged", () => { if (current() === "listen") renderLists() });
$("l-collab").addEventListener("click", e => {
  if (e.target.id !== "l-cbshare") return;
  const list = P().lists.find(l => l.id === cur()); if (list?.collab) shareLink(list);
});
