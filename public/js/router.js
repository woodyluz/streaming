// Ansichten anhand der Adresse (#entdecken, #t-movie-123, #p-456 …) anzeigen
import { hasAuth } from "./state.js";
import { $ } from "./util.js";

export const VIEWS = ["setup", "entdecken", "suche", "neu", "kalender", "top", "fuerdich", "aehnlich", "listen", "planer", "statistik", "person", "abstimmen", "liste", "gemeinsam", "einstellungen"];
const SPECIAL = ["setup", "person", "abstimmen", "liste", "gemeinsam"];
const views = {};
let cur = "", hooks = {};
export const current = () => cur;
export const register = (name, render) => { views[name] = render };
export const setHooks = h => { hooks = h };

export function show(v){
  cur = v;
  for (const x of VIEWS) $("v-" + x).hidden = x !== v;
  $("tabs").hidden = v === "setup";
  for (const a of $("tabs").querySelectorAll("a")) a.dataset.v === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
}
export function route(){
  let h = decodeURIComponent(location.hash.slice(1));
  const cb = h.match(/^gemeinsam-([A-Za-z0-9]{12})$/);
  if (cb){ hooks.closeDetail?.(true); show("gemeinsam"); views.gemeinsam?.(cb[1]); return }
  const vt = h.match(/^abstimmen-([A-Za-z0-9]{10})$/), sl = h.match(/^liste-([A-Za-z0-9]{10})$/);
  if (vt || sl){
    hooks.closeDetail?.(true);
    show(vt ? "abstimmen" : "liste"); views[vt ? "abstimmen" : "liste"]?.((vt || sl)[1]); window.scrollTo(0, 0); return;
  }
  if (!hasAuth()){ show("setup"); return }
  if (h.startsWith("sync-")){
    hooks.consumeSync?.(h.slice(5));
    history.replaceState(null, "", location.pathname + "#einstellungen");
    h = "einstellungen";
  }
  const t = h.match(/^t-(movie|tv)-(\d+)$/);
  if (t){
    if (!cur || cur === "setup"){ show("entdecken"); views.entdecken?.() }
    hooks.openDetail?.(t[1], t[2], true);
    return;
  }
  hooks.closeDetail?.(true);
  const p = h.match(/^p-(\d+)$/);
  if (p){ show("person"); views.person?.(p[1]); window.scrollTo(0, 0); return }
  let v = h || "entdecken";
  if (!VIEWS.includes(v) || SPECIAL.includes(v)) v = "entdecken";
  if (hooks.guard && !hooks.guard(v)){ location.replace("#" + (cur && cur !== v && !SPECIAL.includes(cur) ? cur : "entdecken")); return }
  if (v === "suche" && $("q").value.trim().length < 2) v = "entdecken";
  const changedView = v !== cur;
  show(v);
  views[v]?.();
  if (changedView && h) $("main").focus({preventScroll: true});
}
window.addEventListener("hashchange", () => route());

// Aktuelle Ansicht nach Datenänderungen neu zeichnen
export function rerender(){
  if (!cur || cur === "setup") return;
  if (cur === "person") return route();
  views[cur]?.({refresh: true});
}
