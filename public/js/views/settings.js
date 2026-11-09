// Einstellungen: Dienste, Profile, Sync, Mitteilungen, Länder, Schlüssel, Daten
import { S, CFG, save, changed, emit, profile, hasAuth } from "../state.js";
import { COUNTRIES, IMG, FSK } from "../constants.js";
import { emptyProfile } from "../merge.js";
import { $, esc, toast, copy } from "../util.js";
import { tmdb, saShow, omdb, SA, OM } from "../api.js";
import { providerList, isSwiss } from "../data.js";
import { hasPin, setPin, needsPinFor, askPin } from "../pin.js";
import { traktImport } from "../trakt.js";
import { workerApi } from "../api.js";
import { restoreFrom } from "../merge.js";
import { SYNC_FIELDS } from "../state.js";
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
  renderPin();
  renderTrakt();
  $("city").value = S.city || "";
  try {
    const list = await providerList();
    const swiss = list.filter(p => isSwiss(p.provider_name)), rest = list.filter(p => !isSwiss(p.provider_name));
    const shown = pvShowAll ? rest : rest.filter((p, i) => i < 24 || S.mine.includes(p.provider_id));
    const btn = p => `<button type="button" class="pv" data-pv="${p.provider_id}" aria-pressed="${S.mine.includes(p.provider_id)}"><img src="${IMG}w92${p.logo_path}" alt="">${esc(p.provider_name)}</button>`;
    $("pv-grid").innerHTML = (swiss.length && S.country === "CH" ? `<div class="swissgroup" style="width:100%"><p class="label">Aus der Schweiz</p><div class="pvgrid">${swiss.map(btn).join("")}</div></div><p class="label" style="width:100%;margin-top:6px">Weitere Dienste</p>` : "")
      + (S.country === "CH" ? shown : [...swiss, ...shown]).map(btn).join("");
    $("pv-all").hidden = pvShowAll || list.length <= shown.length;
  } catch(e){ $("pv-grid").innerHTML = `<p class="empty">${esc(e.message)}</p>` }
}

/* ---------- Profile ---------- */
function renderProfiles(){
  $("pf-list").innerHTML = S.profiles.map(p => `<div class="prof">
    <div><label class="vh" for="pfn-${p.id}">Name von Profil ${esc(p.name)}</label><input type="text" id="pfn-${p.id}" data-pfname="${p.id}" value="${esc(p.name)}" maxlength="24"></div>
    <div><label class="vh" for="pff-${p.id}">Altersgrenze für ${esc(p.name)}</label><select id="pff-${p.id}" data-pffsk="${p.id}">${fskOptions("Keine Altersgrenze")}</select></div>
    ${p.id === "main" ? `<span class="empty" style="font-size:12px">Hauptprofil</span>` : `<button type="button" data-pfdel="${p.id}" aria-label="Profil ${esc(p.name)} löschen">Löschen</button>`}
    <label class="chk"><input type="checkbox" data-pfsp="${p.id}" ${p.spoiler ? "checked" : ""}> Spoiler-Schutz: keine Folgentitel für ungesehene Folgen</label>
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
export async function switchProfile(id){
  if (!S.profiles.some(p => p.id === id)) return;
  if (needsPinFor(id) && !(await askPin(`Zum Wechsel in das Profil „${S.profiles.find(p => p.id === id).name}“ braucht es die PIN.`))){ fillProfileSelect(); return }
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
  const sp = e.target.closest("[data-pfsp]");
  if (sp){ const p = S.profiles.find(x => x.id === sp.dataset.pfsp); if (p){ p.spoiler = sp.checked; p.nt = Date.now(); changed("profiles") } }
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

/* ---------- Kinderschutz ---------- */
function renderPin(){
  $("pin-off").hidden = !hasPin();
  $("pin-info").textContent = hasPin()
    ? "Eine PIN ist gesetzt. Aus Profilen mit Altersgrenze geht es nur mit PIN in andere Profile oder in die Einstellungen."
    : "Mit einer PIN kann aus einem Profil mit Altersgrenze niemand ohne Erlaubnis in ein anderes Profil oder in die Einstellungen wechseln.";
}
$("pin-form").addEventListener("submit", async e => {
  e.preventDefault();
  const v = $("pin-new").value.trim();
  if (!/^\d{4,6}$/.test(v)){ $("pin-status").textContent = "Die PIN braucht 4 bis 6 Ziffern."; return }
  await setPin(v); $("pin-new").value = ""; $("pin-status").textContent = "PIN gespeichert. Sie gilt auf allen verbundenen Geräten."; renderPin();
});
$("pin-off").addEventListener("click", async () => { await setPin(""); $("pin-status").textContent = "PIN entfernt."; renderPin() });

/* ---------- Sicherungen ---------- */
const fmtBk = id => { const d = new Date(id.length > 10 ? id + "Z" : id + "T12:00:00Z"); return d.toLocaleDateString("de-CH", {day: "numeric", month: "long", year: "numeric"}) + (id.length > 10 ? ", " + d.toLocaleTimeString("de-CH", {hour: "2-digit", minute: "2-digit"}) : "") };
async function loadBackups(){
  const st = $("bk-status");
  try {
    const list = await workerApi("/api/backups");
    $("bk-list").innerHTML = list.length ? list.map(id => `<div class="row"><span>${fmtBk(id)}${id.length > 10 ? " (von Hand)" : ""}</span><button type="button" data-bk="${id}">Zurückholen</button></div>`).join("") : `<p class="empty">Noch keine Sicherungen.</p>`;
    st.textContent = "";
  } catch(e){ st.textContent = e.message }
}
$("bk-load").addEventListener("click", loadBackups);
$("bk-now").addEventListener("click", async () => {
  try { await syncNow(true); await workerApi("/api/backups", {method: "POST"}); $("bk-status").textContent = "Gesichert."; loadBackups() } catch(e){ $("bk-status").textContent = e.message }
});
$("bk-list").addEventListener("click", async e => {
  const b = e.target.closest("[data-bk]"); if (!b) return;
  b.disabled = true; $("bk-status").textContent = "Hole Sicherung …";
  try {
    const d = await workerApi("/api/backups/" + b.dataset.bk);
    const local = {}; for (const f of SYNC_FIELDS) local[f] = S[f];
    const m = restoreFrom(local, d.data || {});
    for (const f of SYNC_FIELDS){ if (m[f] !== undefined){ S[f] = m[f]; save(f) } }
    emit("dirty", "pdata"); emit("synced");
    $("bk-status").textContent = `Sicherung vom ${fmtBk(b.dataset.bk)} zurückgeholt und mit deinem aktuellen Stand zusammengeführt.`;
  } catch(err){ $("bk-status").textContent = err.message } finally { b.disabled = false }
});

/* ---------- Trakt ---------- */
let traktPoll = null;
async function renderTrakt(){
  const tools = $("tr-tools"), st = $("tr-status");
  clearInterval(traktPoll); $("tr-code").innerHTML = "";
  if (!syncReady()){ tools.innerHTML = ""; st.textContent = "Dafür muss dieses Gerät verbunden sein."; return }
  try {
    const s = await workerApi("/api/trakt/status");
    st.textContent = s.connected && S.meta.__traktLast ? "Zuletzt abgeglichen: " + new Date(S.meta.__traktLast).toLocaleString("de-CH", {dateStyle: "medium", timeStyle: "short"}) : "";
    tools.innerHTML = s.connected ? `<button type="button" class="primary" id="tr-sync">Jetzt abgleichen</button><button type="button" id="tr-off">Trennen</button>` : `<button type="button" class="primary" id="tr-on">Mit Trakt verbinden</button>`;
  } catch(e){
    tools.innerHTML = "";
    st.textContent = e.code === 501 ? "Im Worker fehlen TRAKT_CLIENT_ID und TRAKT_CLIENT_SECRET. Siehe README." : e.message;
  }
}
$("tr-tools").addEventListener("click", async e => {
  const st = $("tr-status");
  if (e.target.id === "tr-sync"){
    st.textContent = "Gleiche ab …";
    try { const r = await traktImport(); S.meta.__traktOn = true; save("meta"); st.textContent = `Übernommen: ${r.movies} Filme als gesehen, ${r.shows} Serien-Stände.` } catch(err){ st.textContent = err.message }
  }
  if (e.target.id === "tr-off"){ try { await workerApi("/api/trakt", {method: "DELETE"}); S.meta.__traktOn = false; save("meta"); renderTrakt() } catch(err){ st.textContent = err.message } }
  if (e.target.id === "tr-on"){
    try {
      const c = await workerApi("/api/trakt/code", {method: "POST"});
      $("tr-code").innerHTML = `<p>Öffne <a href="${esc(c.verification_url)}" target="_blank" rel="noopener">${esc(c.verification_url.replace(/^https?:\/\//, ""))}</a> und gib diesen Code ein:</p><p class="trakt-code">${esc(c.user_code)}</p>`;
      st.textContent = "Warte auf Bestätigung bei Trakt …";
      traktPoll = setInterval(async () => {
        try {
          const r = await workerApi("/api/trakt/poll", {method: "POST"});
          if (r.state === "ok"){ clearInterval(traktPoll); S.meta.__traktOn = true; save("meta"); $("tr-code").innerHTML = ""; st.textContent = "Verbunden. Ich gleiche jetzt ab …"; const x = await traktImport(); st.textContent = `Verbunden. Übernommen: ${x.movies} Filme, ${x.shows} Serien-Stände.`; renderTrakt() }
          if (r.state === "expired" || r.state === "denied"){ clearInterval(traktPoll); st.textContent = r.state === "denied" ? "Bei Trakt abgelehnt." : "Der Code ist abgelaufen. Versuch es noch einmal."; $("tr-code").innerHTML = "" }
        } catch(err){ clearInterval(traktPoll); st.textContent = err.message }
      }, Math.max(5, c.interval || 5) * 1000);
    } catch(err){ st.textContent = err.message }
  }
});

/* ---------- Kino ---------- */
$("city-form").addEventListener("submit", e => { e.preventDefault(); S.city = $("city").value.trim().slice(0, 40); changed("city"); toast(S.city ? `Kino-Stadt: ${S.city}` : "Kino-Stadt entfernt") });

register("einstellungen", renderSettings);
export { renderSettings, hasAuth };
