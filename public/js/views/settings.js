// Einstellungen: Dienste, Profile, Sync, Mitteilungen, Länder, Schlüssel, Daten
import { S, CFG, save, changed, emit, profile, hasAuth } from "../state.js";
import { COUNTRIES, IMG, FSK } from "../constants.js";
import { emptyProfile } from "../merge.js";
import { $, esc, toast, copy } from "../util.js";
import { tmdb, saShow, omdb, SA, OM } from "../api.js";
import { providerList } from "../data.js";
import { cclear } from "../cache.js";
import { syncReady, syncNow, api, writeMeta, enablePush, notify } from "../sync.js";
import { register, route, current } from "../router.js";
import { exportBackup } from "./importer.js";
import { exportCSV } from "./lists.js";
import { fillFilters } from "./discover.js";

let pvShowAll = false, pfDelete = null;

export const fskOptions = (first = "Alle Altersstufen") =>
  `<option value="">${first}</option>` + FSK.filter(n => n < 18).map(n => `<option value="${n}">bis FSK ${n}</option>`).join("");

async function renderSettings(){
  const a = $("a-info");
  a.textContent = S.proxy ? `Verbunden über deinen Worker: ${S.proxy}` : "Verbunden mit deinem eigenen API-Schlüssel (nur in diesem Browser gespeichert).";
  if (CFG.proxy && S.proxy === CFG.proxy.trim()) a.textContent = "Verbunden über den Worker aus config.js. Auf keinem Gerät ist ein Schlüssel nötig.";
  $("proxyInput").value = S.proxy;
  $("sa-info").textContent = S.sa ? "Dein eigener RapidAPI-Schlüssel ist in diesem Browser gespeichert."
    : SA.needsLink ? "Der Worker gibt direkte Links nur an verbundene Geräte. Verbinde dieses Gerät oben unter „Geräte synchronisieren“."
    : S.proxy ? "Läuft über deinen Worker, sofern dort SA_KEY gesetzt ist. Ein eigener Schlüssel hier hat Vorrang."
    : "Hol dir auf rapidapi.com einen Schlüssel für die „Streaming Availability“ API (Basic-Plan ist kostenlos) und füge ihn hier ein.";
  $("saRemove").hidden = !S.sa;
  $("om-info").textContent = S.omdb ? "Dein OMDb-Schlüssel ist in diesem Browser gespeichert." : S.proxy ? "Läuft über deinen Worker, sofern dort OMDB_KEY gesetzt ist und dieses Gerät verbunden ist." : "";
  $("omRemove").hidden = !S.omdb;
  $("y-info").textContent = !S.proxy ? "Damit Listen, Profile und Verlauf auf allen Geräten gleich sind, brauchst du den Cloudflare-Worker (siehe README)."
    : syncReady() ? "Dieses Gerät ist verbunden. Listen, Profile, Dienste, Gesehen und Serien-Stand werden automatisch abgeglichen."
    : "Gib das Sync-Passwort ein, das du im Worker als SYNC_SECRET hinterlegt hast. Das ist einmal pro Gerät nötig.";
  $("y-form").hidden = !S.proxy || syncReady();
  $("y-tools").hidden = !syncReady();
  $("cc-grid").innerHTML = Object.entries(COUNTRIES).filter(([c]) => c !== S.country).map(([c, n]) =>
    `<label class="cc"><input type="checkbox" value="${c}" ${S.compare.includes(c) ? "checked" : ""}> ${n}</label>`).join("");
  renderProfiles();
  renderNotify();
  try {
    const list = await providerList();
    const shown = pvShowAll ? list : list.filter((p, i) => i < 24 || S.mine.includes(p.provider_id));
    $("pv-grid").innerHTML = shown.map(p => `<button type="button" class="pv" data-pv="${p.provider_id}" aria-pressed="${S.mine.includes(p.provider_id)}">
      <img src="${IMG}w92${p.logo_path}" alt="">${esc(p.provider_name)}</button>`).join("");
    $("pv-all").hidden = pvShowAll || list.length <= shown.length;
  } catch(e){ $("pv-grid").innerHTML = `<p class="empty">${esc(e.message)}</p>` }
}

/* ---------- Profile ---------- */
function renderProfiles(){
  $("pf-list").innerHTML = S.profiles.map(p => `<div class="prof">
    <div><label class="vh" for="pfn-${p.id}">Name von Profil ${esc(p.name)}</label><input type="text" id="pfn-${p.id}" data-pfname="${p.id}" value="${esc(p.name)}" maxlength="24"></div>
    <div><label class="vh" for="pff-${p.id}">Altersgrenze für ${esc(p.name)}</label><select id="pff-${p.id}" data-pffsk="${p.id}">${fskOptions("Keine Altersgrenze")}</select></div>
    ${p.id === "main" ? `<span class="empty" style="font-size:12px">Hauptprofil</span>` : `<button type="button" data-pfdel="${p.id}" aria-label="Profil ${esc(p.name)} löschen">Löschen</button>`}
  </div>`).join("");
  for (const p of S.profiles){ const sel = $("pff-" + p.id); sel.value = p.maxFsk === null || p.maxFsk === undefined ? "" : String(p.maxFsk) }
  $("pf-confirm").hidden = !pfDelete;
}
export function fillProfileSelect(){
  const sel = $("profileSel");
  sel.innerHTML = S.profiles.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  sel.value = S.profile;
  sel.hidden = S.profiles.length < 2;
}
export function switchProfile(id){
  if (!S.profiles.some(p => p.id === id)) return;
  S.profile = id; save("profile");
  fillProfileSelect();
  emit("profile");
  route();
  toast(`Profil „${profile().name}“`);
}
$("profileSel").addEventListener("change", e => switchProfile(e.target.value));
$("pf-list").addEventListener("change", e => {
  const n = e.target.closest("[data-pfname]"), f = e.target.closest("[data-pffsk]");
  if (n){ const p = S.profiles.find(x => x.id === n.dataset.pfname); if (p && n.value.trim()){ p.name = n.value.trim().slice(0, 24); p.nt = Date.now(); changed("profiles"); fillProfileSelect() } }
  if (f){ const p = S.profiles.find(x => x.id === f.dataset.pffsk); if (p){ p.maxFsk = f.value === "" ? null : +f.value; p.nt = Date.now(); changed("profiles"); emit("profile") } }
});
$("pf-list").addEventListener("click", e => {
  const d = e.target.closest("[data-pfdel]"); if (!d) return;
  pfDelete = d.dataset.pfdel;
  const p = S.profiles.find(x => x.id === pfDelete);
  $("pf-confirm").innerHTML = `<span>Profil „${esc(p.name)}“ mit allen Listen löschen?</span><button type="button" class="primary" id="pf-yes">Löschen</button><button type="button" id="pf-no">Abbrechen</button>`;
  $("pf-confirm").hidden = false; $("pf-no").focus();
});
$("pf-confirm").addEventListener("click", e => {
  if (e.target.id === "pf-yes" && pfDelete){
    S.ptomb[pfDelete] = Date.now(); changed("ptomb");
    S.profiles = S.profiles.filter(p => p.id !== pfDelete); delete S.pdata[pfDelete];
    changed("profiles"); changed("pdata");
    if (S.profile === pfDelete) switchProfile("main"); else fillProfileSelect();
    toast("Profil gelöscht");
  }
  if (e.target.id === "pf-yes" || e.target.id === "pf-no"){ pfDelete = null; renderProfiles() }
});
$("pf-new").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("pf-name").value.trim(); if (!name) return;
  const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  S.profiles.push({id, name: name.slice(0, 24), nt: Date.now(), maxFsk: null});
  S.pdata[id] = emptyProfile();
  changed("profiles"); changed("pdata");
  $("pf-name").value = "";
  fillProfileSelect(); renderProfiles();
  toast(`Profil „${name}“ angelegt. Oben neben dem Land wechselst du zwischen den Profilen.`);
});

/* ---------- Mitteilungen ---------- */
function renderNotify(){
  const has = "Notification" in window;
  const canPush = has && "PushManager" in window && "serviceWorker" in navigator && location.protocol === "https:";
  $("n-info").textContent = !has ? "Dieser Browser unterstützt keine Mitteilungen. Auf dem iPhone: Seite zuerst zum Home-Bildschirm hinzufügen und von dort öffnen."
    : syncReady() ? "Mit Push prüft der Worker täglich deine Listen und Serien und meldet neue Verfügbarkeiten, auslaufende Titel und neue Folgen, auch wenn die App geschlossen ist."
    : "Ohne Worker prüft Streamfinder deine Listen beim Öffnen. Für echte Push-Mitteilungen richte den Worker und den Geräte-Sync ein.";
  $("n-btn").hidden = !has || Notification.permission !== "default" || syncReady();
  $("push-btn").hidden = !canPush || !syncReady() || S.pushOn;
  $("push-test").hidden = !syncReady() || !S.pushOn;
  const st = $("n-status");
  if (has && Notification.permission === "denied") st.textContent = "Mitteilungen sind im Browser blockiert. Du kannst sie in den Website-Einstellungen freigeben.";
  else if (S.pushOn && !st.textContent) st.textContent = "Push ist aktiv.";
}
$("n-btn").addEventListener("click", async () => { try { await Notification.requestPermission() } catch(e){} renderNotify(); notify("Streamfinder", "Mitteilungen sind eingerichtet.") });
$("push-btn").addEventListener("click", async () => {
  try { await enablePush(); $("n-status").textContent = "Push ist aktiv. Der Worker meldet sich, auch wenn die App geschlossen ist."; renderNotify() }
  catch(e){ $("n-status").textContent = e.message || "Push konnte nicht aktiviert werden." }
});
$("push-test").addEventListener("click", async () => {
  try { await writeMeta(); await api("/api/push/test", {method: "POST"}); $("n-status").textContent = "Test gesendet. Die Mitteilung sollte gleich erscheinen." }
  catch(e){ $("n-status").textContent = e.message }
});

/* ---------- Dienste, Länder ---------- */
$("pv-grid").addEventListener("click", e => {
  const b = e.target.closest("[data-pv]"); if (!b) return;
  const id = +b.dataset.pv, i = S.mine.indexOf(id);
  i >= 0 ? S.mine.splice(i, 1) : S.mine.push(id);
  b.setAttribute("aria-pressed", i < 0);
  changed("mine"); emit("settings"); fillFilters();
});
$("pv-all").addEventListener("click", () => { pvShowAll = true; renderSettings() });
$("cc-grid").addEventListener("change", () => { S.compare = [...$("cc-grid").querySelectorAll("input:checked")].map(i => i.value); changed("compare") });

/* ---------- Sync ---------- */
$("y-form").addEventListener("submit", async e => {
  e.preventDefault();
  const v = $("y-input").value.trim(); if (!v) return;
  const old = S.sync; S.sync = v; $("y-status").textContent = "Verbinde …";
  try { await syncNow(true); save("sync"); $("y-input").value = ""; await writeMeta(); SA.off = false; SA.needsLink = false; OM.off = false; renderSettings(); toast("Gerät verbunden") }
  catch(err){ S.sync = old; $("y-status").textContent = err.message }
});
export function consumeSync(secret){
  S.sync = secret; save("sync");
  syncNow(true).then(() => { writeMeta(); SA.off = false; SA.needsLink = false; OM.off = false; toast("Gerät verbunden"); if (current() === "einstellungen") renderSettings() })
    .catch(e => { S.sync = ""; save("sync"); toast(e.message) });
}
$("y-now").addEventListener("click", () => { $("y-status").textContent = "Synchronisiere …"; syncNow() });
$("y-link").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#sync-" + encodeURIComponent(S.sync);
  $("y-status").textContent = await copy(url)
    ? "Link kopiert. Öffne ihn auf dem anderen Gerät. Er enthält dein Sync-Passwort, teile ihn mit niemandem."
    : "Kopieren ging nicht. Gib auf dem anderen Gerät einfach das Sync-Passwort ein.";
});
$("y-off").addEventListener("click", () => { S.sync = ""; save("sync"); S.pushOn = false; save("pushOn"); renderSettings(); $("y-status").textContent = "Getrennt. Die Daten bleiben auf diesem Gerät." });

/* ---------- Schlüssel ---------- */
async function saveAuth(key, proxy, statusEl){
  const old = {key: S.key, proxy: S.proxy};
  S.key = key; S.proxy = proxy;
  statusEl.textContent = "Prüfe Zugang …";
  try {
    await tmdb("/configuration", {}, 0);
    save("key"); save("proxy"); await cclear();
    statusEl.textContent = "Gespeichert.";
    emit("settings"); await fillFilters();
    location.hash = "entdecken"; route(); syncNow();
  } catch(e){ S.key = old.key; S.proxy = old.proxy; statusEl.textContent = e.message }
}
$("setupForm").addEventListener("submit", e => { e.preventDefault(); const k = $("setupKey").value.trim(); if (k) saveAuth(k, "", $("setupStatus")) });
$("keyForm").addEventListener("submit", e => { e.preventDefault(); const k = $("keyInput").value.trim(); if (k) saveAuth(k, "", $("a-status")) });
$("proxyForm").addEventListener("submit", e => { e.preventDefault(); const p = $("proxyInput").value.trim(); saveAuth(p ? "" : S.key, p, $("a-status")) });
$("saForm").addEventListener("submit", async e => {
  e.preventDefault();
  const k = $("saInput").value.trim(); if (!k) return;
  const old = S.sa; S.sa = k; SA.off = false;
  $("sa-status").textContent = "Prüfe Schlüssel …";
  try { await saShow("movie", 238, 0); save("sa"); $("saInput").value = ""; $("sa-status").textContent = "Gespeichert. Direkte Links erscheinen jetzt in den Details."; renderSettings() }
  catch(err){ S.sa = old; $("sa-status").textContent = err.message }
});
$("saRemove").addEventListener("click", () => { S.sa = ""; save("sa"); SA.off = false; $("sa-status").textContent = "Entfernt."; renderSettings() });
$("omForm").addEventListener("submit", async e => {
  e.preventDefault();
  const k = $("omInput").value.trim(); if (!k) return;
  const old = S.omdb; S.omdb = k; OM.off = false;
  $("om-status").textContent = "Prüfe Schlüssel …";
  try { await omdb("tt0068646", 0); save("omdb"); $("omInput").value = ""; $("om-status").textContent = "Gespeichert. Bewertungen erscheinen jetzt in den Details."; renderSettings() }
  catch(err){ S.omdb = old; $("om-status").textContent = err.message === "off" ? "Der Schlüssel konnte nicht geprüft werden." : err.message }
});
$("omRemove").addEventListener("click", () => { S.omdb = ""; save("omdb"); OM.off = false; $("om-status").textContent = "Entfernt."; renderSettings() });

/* ---------- Daten ---------- */
$("x-json").addEventListener("click", exportBackup);
$("x-csv").addEventListener("click", exportCSV);
$("clearCache").addEventListener("click", async () => { await cclear(); $("c-status").textContent = "Zwischenspeicher geleert." });
$("logout").addEventListener("click", () => { S.key = ""; S.proxy = ""; save("key"); save("proxy"); cclear(); route() });

register("einstellungen", renderSettings);
export { renderSettings, hasAuth };
