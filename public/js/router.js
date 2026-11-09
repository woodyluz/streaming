// Ansichten anhand der Adresse (#entdecken, #t-movie-123, #p-456 …) anzeigen
import { hasAuth } from "./state.js";
import { $ } from "./util.js";

export const VIEWS = ["setup", "entdecken", "suche", "neu", "kalender", "top", "fuerdich", "listen", "statistik", "person", "einstellungen"];
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
  if (!hasAuth()){ show("setup"); return }
  let h = decodeURIComponent(location.hash.slice(1));
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
  if (!VIEWS.includes(v) || v === "setup" || v === "person") v = "entdecken";
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
