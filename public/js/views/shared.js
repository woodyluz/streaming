// Geteilte Listen: Leselink erstellen (mit Passwort) und für alle anzeigen
import { S, P, profile, save } from "../state.js";
import { IMG } from "../constants.js";
import { $, esc, toast, copy } from "../util.js";
import { workerApi } from "../api.js";
import { cardHTML, decorate } from "../cards.js";
import { register } from "../router.js";
import { syncReady } from "../sync.js";

const stars = n => n ? "★".repeat(n) + "☆".repeat(5 - n) : "";

// Liste teilen oder aktualisieren; die ID wird pro Liste gemerkt
export async function shareList(listId){
  const pd = P(), l = pd.lists.find(x => x.id === listId);
  if (!l) return;
  if (!syncReady()){ toast("Zum Teilen muss dieses Gerät verbunden sein (Einstellungen → Geräte synchronisieren)."); return }
  S.meta.__shares = S.meta.__shares || {};
  const prev = S.meta.__shares[listId];
  const items = l.items.map(i => { const w = pd.watched[i.key]; return {key: i.key, title: i.title, poster: i.poster, year: i.year, stars: w?.stars || 0, note: w?.note || ""} });
  try {
    const {id} = await workerApi("/api/share", {method: "POST", body: {id: prev, title: l.name, by: profile().name, items}});
    S.meta.__shares[listId] = id; save("meta");
    const url = location.origin + location.pathname + "#liste-" + id;
    try { if (navigator.share){ await navigator.share({title: l.name, text: `Meine Liste „${l.name}“`, url}); return url } } catch(e){ if (e.name === "AbortError") return url }
    toast(await copy(url) ? (prev ? "Link aktualisiert und kopiert" : "Link kopiert. Alle mit dem Link können die Liste ansehen.") : url);
    return url;
  } catch(e){ toast(e.message) }
}
export async function unshareList(listId){
  const id = S.meta.__shares?.[listId]; if (!id) return;
  try { await workerApi("/api/share/" + id, {method: "DELETE"}); delete S.meta.__shares[listId]; save("meta"); toast("Link gelöscht. Die Liste ist nicht mehr öffentlich.") }
  catch(e){ toast(e.message) }
}
export const sharedId = listId => S.meta.__shares?.[listId] || null;

async function load(id){
  $("sl-head").innerHTML = `<p class="status">Lade Liste …</p>`; $("sl-grid").innerHTML = ""; $("sl-status").textContent = "";
  let d;
  try { d = await workerApi("/api/share/" + id, {auth: false}) }
  catch(e){ $("sl-head").innerHTML = `<p class="hint">${e.code === 404 ? "Diese Liste wurde nicht gefunden oder nicht mehr geteilt." : esc(e.message)}</p>`; return }
  $("sl-head").innerHTML = `<div class="phead" style="grid-template-columns:1fr"><div><p class="label">Geteilte Liste${d.by ? " von " + esc(d.by) : ""}</p><h2>${esc(d.title)}</h2>
    <p>${d.items.length} Titel · zuletzt aktualisiert ${new Date(d.updated).toLocaleDateString("de-CH", {day: "numeric", month: "long", year: "numeric"})}</p>
    <p>Tippe auf einen Titel, um zu sehen, wo er läuft. Mit dem Lesezeichen merkst du ihn dir in deiner eigenen Liste.</p></div></div>`;
  $("sl-grid").innerHTML = d.items.map(i => cardHTML({media_type: i.type, id: i.id, title: i.title, poster_path: i.poster, year: i.year},
    {meta: [i.type === "tv" ? "Serie" : "Film", i.year, stars(i.stars)].filter(Boolean).join(" · ") + (i.note ? " · „" + i.note + "“" : "")})).join("");
  decorate($("sl-grid"));
}
register("liste", id => { if (typeof id === "string") load(id) });
