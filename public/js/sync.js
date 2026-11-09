// Abgleich zwischen Geräten über den Worker: abholen, zusammenführen, zurückschreiben.
import { S, SYNC_FIELDS, save, emit, on, proxyBase } from "./state.js";
import { mergeAll } from "./merge.js";
import { MINE_NAMES } from "./data.js";
import { $ } from "./util.js";

export const syncReady = () => !!(S.proxy && S.sync);

export async function api(path, opt = {}){
  let res;
  try { res = await fetch(proxyBase() + path, {...opt, headers: {Authorization: "Bearer " + S.sync, "Content-Type": "application/json"}}) }
  catch(e){ throw new Error("Der Worker ist nicht erreichbar.") }
  if (res.status === 401) throw new Error("Das Sync-Passwort stimmt nicht.");
  if (res.status === 501) throw new Error("Im Worker fehlt SYNC_SECRET oder der Speicher SF_KV. Siehe README.");
  if (!res.ok) throw new Error("Sync-Fehler " + res.status + ".");
  return res.status === 204 ? null : res.json();
}
function status(msg){ const el = $("y-status"); if (el) el.textContent = msg }
const now = () => new Date().toLocaleTimeString("de-CH", {hour: "2-digit", minute: "2-digit"});

let running = null, again = false;
export async function syncNow(loud){
  if (!syncReady()) return;
  if (running){ again = true; return running }
  running = (async () => {
    try {
      const d = await api("/api/data");
      const local = {};
      for (const f of SYNC_FIELDS) local[f] = S[f];
      const remote = d && d.data ? {...d.data, setT: d.data.setT ?? d.updated} : {};
      const m = mergeAll(local, remote);
      const before = JSON.stringify(local);
      for (const f of SYNC_FIELDS){ S[f] = m[f]; save(f) }
      if (!S.profiles.some(p => p.id === S.profile)){ S.profile = "main"; save("profile") }
      const data = {...m, v: 2, mineNames: Object.fromEntries(S.mine.map(id => [id, MINE_NAMES.get(id) || ""]))};
      await api("/api/data", {method: "PUT", body: JSON.stringify({updated: Date.now(), data})});
      if (JSON.stringify(m) !== before) emit("synced");
      status("Synchronisiert um " + now());
    } catch(e){ status(e.message); if (loud) throw e }
  })();
  try { return await running } finally {
    running = null;
    if (again){ again = false; syncNow() }
  }
}
let timer;
on("dirty", () => { if (!syncReady()) return; clearTimeout(timer); timer = setTimeout(() => syncNow(), 1200) });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow() });

/* ---------- Push ---------- */
const b64uToBytes = s => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)) };
export async function writeMeta(){
  try {
    const c = await caches.open("sf-meta"), old = await c.match("./__meta"), m = old ? await old.json() : {};
    await c.put("./__meta", new Response(JSON.stringify({...m, proxy: S.proxy, sync: S.sync})));
  } catch(e){}
}
export async function enablePush(){
  if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") throw new Error("Mitteilungen wurden nicht erlaubt.");
  const reg = await navigator.serviceWorker.ready;
  const {key} = await api("/api/push/key");
  const sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64uToBytes(key)});
  await api("/api/push/subscribe", {method: "POST", body: JSON.stringify(sub)});
  await writeMeta();
  S.pushOn = true; save("pushOn");
}
export async function notify(title, body){
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opt = {body, icon: "icon-192.png", tag: "sf-" + title + body};
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    reg ? reg.showNotification(title, opt) : new Notification(title, opt);
  } catch(e){}
}
