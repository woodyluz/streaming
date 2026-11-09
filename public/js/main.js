// Einstiegspunkt: Module laden, globale Bedienelemente verbinden, App starten
import { S, P, save, changed, emit, on, hasAuth } from "./state.js";
import { COUNTRIES } from "./constants.js";
import { $, pool, toast } from "./util.js";
import { regions } from "./api.js";
import { dropLegacy, cprune } from "./cache.js";
import { listItems, flatOf, backfill, ITEMS, setWatched } from "./data.js";
import { enableSwipe } from "./cards.js";
import { restricted, askPin } from "./pin.js";
import { traktImport } from "./trakt.js";
import "./views/planner.js";
import "./views/vote.js";
import "./views/shared.js";
import { syncNow, syncReady, writeMeta, notify } from "./sync.js";
import { onSave, openPicker } from "./picker.js";
import { route, rerender, setHooks } from "./router.js";
import { isOpen } from "./a11y.js";
import { fillFilters } from "./views/discover.js";
import "./views/news.js";
import "./views/foryou.js";
import { updateBadge } from "./views/lists.js";
import "./views/calendar.js";
import "./views/stats.js";
import { openDetail, closeDetail } from "./views/detail.js";
import "./views/importer.js";
import { fskOptions, fillProfileSelect, consumeSync } from "./views/settings.js";

setHooks({openDetail, closeDetail: () => closeDetail(), consumeSync,
  // Aus eingeschränkten Profilen nur mit PIN in die Einstellungen
  guard: v => {
    if (v !== "einstellungen" || !restricted()) return true;
    askPin("Die Einstellungen sind durch die PIN geschützt.").then(ok => { if (ok) location.hash = "einstellungen" });
    return false;
  }});

/* ---------- Hinweis bei falscher Adresse ---------- */
on("wrongOrigin", () => {
  const b = $("originBanner");
  if (!b.hidden) return;
  const target = S.proxy.replace(/\/+$/, "") + "/" + location.hash;
  b.innerHTML = `<span>Unter dieser Adresse darf Streamfinder deinen Worker nicht nutzen, deshalb fehlen Daten. Öffne Streamfinder über deine Worker-Adresse.</span><a href="${target}">Zu ${new URL(S.proxy).host} wechseln</a>`;
  b.hidden = false;
});

/* ---------- Wischen auf dem Handy ---------- */
enableSwipe({
  right: key => onSave(key),
  left: key => { if (!ITEMS.get(key)) return; setWatched(key, true); toast(`„${ITEMS.get(key).title}“ als gesehen markiert`) }
});

/* ---------- Karten-Klicks überall ---------- */
document.addEventListener("click", e => {
  const pk = e.target.closest("[data-pick]");
  if (pk){ openPicker(pk.dataset.pick); return }
  const op = e.target.closest("[data-open]");
  if (op){ const [t, i] = op.dataset.open.split(":"); openDetail(t, i); return }
  const card = e.target.closest(".card"); if (!card) return;
  if (e.target.closest(".save")) onSave(card.dataset.key);
  else if (e.target.closest(".hit")) openDetail(card.dataset.type, card.dataset.id);
});

/* ---------- Land, Profil, Altersfilter, Darstellung ---------- */
for (const [c, n] of Object.entries(COUNTRIES)) $("country").add(new Option(n, c, false, c === S.country));
$("country").addEventListener("change", async e => {
  S.country = e.target.value; changed("country");
  emit("settings"); await fillFilters(); route(); checkLists();
});
for (const sel of document.querySelectorAll(".fsk-select")) sel.innerHTML = fskOptions();
fillProfileSelect();

const THEMES = ["", "light", "dark"], THEME_LABEL = {"": "Darstellung: automatisch", light: "Darstellung: hell", dark: "Darstellung: dunkel"};
function applyTheme(){
  S.theme ? document.documentElement.dataset.theme = S.theme : delete document.documentElement.dataset.theme;
  $("themeBtn").setAttribute("aria-label", THEME_LABEL[S.theme] + ", wechseln"); $("themeBtn").title = THEME_LABEL[S.theme];
}
$("themeBtn").addEventListener("click", () => { S.theme = THEMES[(THEMES.indexOf(S.theme) + 1) % 3]; save("theme"); applyTheme(); toast(THEME_LABEL[S.theme]) });
applyTheme();

/* ---------- Nach Sync oder Profilwechsel ---------- */
on("synced", async () => {
  $("country").value = S.country;
  fillProfileSelect(); updateBadge();
  await fillFilters();
  if (!isOpen($("sheet")) && !isOpen($("picker")) && !isOpen($("imp"))) rerender();
});
on("profile", () => { updateBadge(); checkLists() });

/* ---------- Listen beim Öffnen prüfen (ohne Worker-Push) ---------- */
async function checkLists(){
  const items = listItems();
  if (!items.length) return;
  const reg = await regions(items.map(i => ({type: i.type, id: i.id}))).catch(() => new Map());
  const fresh = [];
  for (const w of items){
    const r = reg.get(w.key); if (r === undefined) continue;
    const flat = flatOf(r), t = S.track[w.key];
    if (t && t.f && t.c === S.country){
      const added = flat.filter(p => !t.f.includes(p.provider_id) && S.mine.includes(p.provider_id));
      if (added.length){ fresh.push([w, [...new Set(added.map(p => p.provider_name))].join(", ")]); t.n = true }
    }
    S.track[w.key] = {f: flat.map(p => p.provider_id), c: S.country, n: !!(t && t.n)};
  }
  save("track"); updateBadge();
  if (!S.pushOn) for (const [w, names] of fresh) notify("Jetzt in deinen Diensten", `${w.title} ist neu bei ${names}`);
}

/* ---------- Start ---------- */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
dropLegacy();
cprune().catch(() => {});
updateBadge();
(async () => {
  if (hasAuth()) await fillFilters();
  route();
  if (hasAuth()){
    checkLists();
    if (syncReady()){
      syncNow(); writeMeta();
      if (S.meta.__traktOn && Date.now() - (S.meta.__traktLast || 0) > 12 * 3600e3) traktImport().catch(() => {});
    }
    setTimeout(() => backfill(60).catch(() => {}), 4000);
  }
})();
