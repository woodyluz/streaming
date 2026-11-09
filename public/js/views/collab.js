// Gemeinsame Listen: ein Link, mit dem Gäste anonym Titel hinzufügen und entfernen.
// Gäste sehen nur diese eine Liste und die ganze Filmauswahl, nie deine anderen Listen.
import { S, P, save, touch, emit, on } from "../state.js";
import { $, esc, toast, copy } from "../util.js";
import { workerApi } from "../api.js";
import { ITEMS } from "../data.js";
import { register, current } from "../router.js";
import { syncReady } from "../sync.js";

const linkOf = id => location.origin + location.pathname + "#gemeinsam-" + id;
let pending = 0;

// Server-Stand in die lokale Liste übernehmen (der Server gilt)
function apply(list, doc){
  const before = list.items.map(i => i.key).join(",");
  const local = new Map(list.items.map(i => [i.key, i]));
  const keys = new Set(doc.items.map(i => i.key));
  const pd = P();
  for (const i of list.items) if (!keys.has(i.key)) pd.tomb.items[list.id + "|" + i.key] = Date.now();
  list.items = doc.items.map(i => local.get(i.key) || {key: i.key, type: i.type, id: i.id, title: i.title, poster: i.poster, year: i.year, added: i.added || Date.now()});
  if (doc.title && list.name !== doc.title && !list.own){ list.name = doc.title }
  if (list.items.map(i => i.key).join(",") !== before){ touch(); return true }
  return false;
}
export async function pull(list){
  if (!list?.collab || pending) return false;
  try {
    const doc = await workerApi("/api/collab/" + list.collab, {auth: false});
    return apply(list, doc);
  } catch(e){
    if (e.code === 404){ list.gone = true; save("pdata") }
    return false;
  }
}

// Eigene Änderungen an den Worker schicken
on("collabOp", async ({list, op, item, key}) => {
  pending++;
  try {
    const body = op === "add" ? {op, item: {key: item.key, title: item.title, poster: item.poster, year: item.year}} : {op, key};
    const doc = await workerApi(`/api/collab/${list.collab}/op`, {method: "POST", body});
    pending--;
    if (apply(list, doc)) emit("collabChanged");
  } catch(e){ pending--; toast(e.code === 404 ? "Diese gemeinsame Liste gibt es nicht mehr." : e.message) }
});
// Liste gelöscht: Besitzer beendet das gemeinsame Bearbeiten
on("collabLeave", l => { if (l.own && syncReady()) workerApi("/api/collab/" + l.collab, {method: "DELETE"}).catch(() => {}) });

// Besitzer: Liste gemeinsam bearbeitbar machen
export async function startCollab(list){
  if (!syncReady()){ toast("Dafür muss dieses Gerät verbunden sein (Einstellungen → Geräte synchronisieren)."); return }
  const doc = await workerApi("/api/collab", {method: "POST", body: {title: list.name, items: list.items.map(i => ({key: i.key, title: i.title, poster: i.poster, year: i.year}))}});
  list.collab = doc.id; list.own = true; list.nt = Date.now(); touch();
  await shareLink(list);
}
export async function stopCollab(list){
  try { await workerApi("/api/collab/" + list.collab, {method: "DELETE"}) } catch(e){ if (e.code !== 404){ toast(e.message); return } }
  delete list.collab; delete list.own; delete list.gone; list.nt = Date.now(); touch();
  toast("Der Link funktioniert nicht mehr. Die Liste gehört wieder nur dir.");
}
export async function shareLink(list){
  const url = linkOf(list.collab);
  try { if (navigator.share){ await navigator.share({title: list.name, text: `Bearbeite mit mir die Liste „${list.name}“`, url}); return } } catch(e){ if (e.name === "AbortError") return }
  toast(await copy(url) ? "Link kopiert. Alle mit dem Link können Titel hinzufügen und entfernen." : url);
}
export const collabLink = list => linkOf(list.collab);

// Gast (oder Besitzer) öffnet den Link
async function join(id){
  $("cb-box").innerHTML = `<p class="status">Öffne gemeinsame Liste …</p>`;
  let doc;
  try { doc = await workerApi("/api/collab/" + id, {auth: false}) }
  catch(e){ $("cb-box").innerHTML = `<p class="hint">${e.code === 404 ? "Diese gemeinsame Liste gibt es nicht mehr oder sie wird nicht mehr geteilt." : esc(e.message)}</p>`; return }
  const pd = P();
  let list = pd.lists.find(l => l.collab === id);
  if (!list){
    list = {id: "c" + id, name: doc.title, nt: Date.now(), items: [], collab: id, own: false};
    pd.lists.push(list);
  }
  delete list.gone;
  apply(list, doc); touch();
  S.curList[S.profile] = list.id; save("curList");
  location.replace("#listen");
}
register("gemeinsam", id => { if (typeof id === "string") join(id) });

// Beim Anzeigen regelmässig nachladen
let timer = null;
export function watch(list){
  clearInterval(timer);
  if (!list?.collab) return;
  timer = setInterval(async () => {
    if (current() !== "listen" || (S.curList[S.profile] !== list.id)){ clearInterval(timer); return }
    if (document.hidden) return;
    if (await pull(list)) emit("collabChanged");
  }, 8000);
}

// Alle gemeinsamen Listen abgleichen: beim Start, beim Zurückkehren in die App und nach dem Sync
export async function pullAll(){
  let any = false;
  for (const l of P().lists) if (l.collab && !l.gone) any = (await pull(l)) || any;
  if (any) emit("collabChanged");
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullAll() });
on("synced", () => pullAll());
on("profile", () => pullAll());
setTimeout(() => pullAll(), 1500);
// Für Gäste ohne Sync: das Lesezeichen speichert direkt in die gemeinsame Liste
export function guestTarget(){
  if (syncReady()) return null;
  const pd = P(), cur = pd.lists.find(l => l.id === S.curList[S.profile]);
  return cur?.collab ? cur : pd.lists.filter(l => l.collab && !l.gone).pop() || null;
}
