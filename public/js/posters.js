// Filmplakate: einheitlich als <img>, mit Ersatzanzeige, Nachladen fehlender und Reparatur kaputter Bilder.
import { S, touch } from "./state.js";
import { IMG, H } from "./constants.js";
import { esc, debounce } from "./util.js";
import { tmdb } from "./api.js";

// Plakat-Markup. Der Titel liegt als Ersatz darunter und ist sichtbar, solange kein Bild da ist.
export function posterHTML(path, {size = "w342", title = "", key = "", url = null, cls = ""} = {}){
  const src = url || (path ? IMG + size + path : "");
  const k = key ? ` data-pkey="${esc(key)}"` : "";
  return `<span class="poster${cls ? " " + cls : ""}" aria-hidden="true"${!src && key ? ` data-need="1"${k} data-size="${size}"` : ""}><span class="ph">${esc(title)}</span>${
    src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" data-size="${size}"${k}>` : ""}</span>`;
}

// Aktuelles Plakat bei TMDB nachschlagen (auch wenn das gespeicherte veraltet ist)
const found = new Map();
async function freshPoster(key){
  if (found.has(key)) return found.get(key);
  const p = (async () => {
    const [type, id] = key.split(":");
    if (!/^(movie|tv)$/.test(type) || !/^\d+$/.test(id)) return null;
    try {
      const d = await tmdb(`/${type}/${id}`, {}, 24 * H);
      if (d.poster_path) return d.poster_path;
      const im = await tmdb(`/${type}/${id}/images`, {include_image_language: "de,en,null"}, 24 * H);
      return im.posters?.[0]?.file_path || null;
    } catch(e){ return null }
  })();
  found.set(key, p);
  return p;
}

// Gespeicherte Titel mit dem neuen Plakat aktualisieren (Listen, Gesehen, Serien)
const saveSoon = debounce(() => touch(), 1500);
function remember(key, path){
  let changed = false;
  for (const pd of Object.values(S.pdata)){
    const fix = i => { if (i && i.key === key && i.poster !== path){ i.poster = path; changed = true } };
    pd.lists.forEach(l => l.items.forEach(fix));
    Object.values(pd.watched).forEach(fix);
    Object.values(pd.follow || {}).forEach(fix);
  }
  if (changed) saveSoon();
}

// Bild lädt nicht: einmal mit neuer Adresse versuchen, sonst Ersatz zeigen
document.addEventListener("error", async e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest(".poster")) return;
  const key = img.dataset.pkey;
  if (key && !img.dataset.retried){
    img.dataset.retried = "1";
    const path = await freshPoster(key);
    const src = path ? IMG + (img.dataset.size || "w342") + path : "";
    if (src && src !== img.src){ img.src = src; remember(key, path); return }
  }
  img.remove();
}, true);

// Titel ohne Plakat: nachladen, sobald sie auf der Seite erscheinen
let queue = new Set(), running = 0;
async function work(){
  while (running < 4 && queue.size){
    const span = queue.values().next().value; queue.delete(span);
    running++;
    (async () => {
      const key = span.dataset.pkey, path = await freshPoster(key);
      if (path && span.isConnected && !span.querySelector("img")){
        span.insertAdjacentHTML("beforeend", `<img src="${IMG + (span.dataset.size || "w342") + esc(path)}" alt="" loading="lazy" decoding="async" data-size="${span.dataset.size || "w342"}" data-pkey="${esc(key)}" data-retried="1">`);
        remember(key, path);
      }
      span.removeAttribute("data-need");
    })().finally(() => { running--; work() });
  }
}
function scan(root){
  if (!(root instanceof Element)) return;
  const list = root.matches?.(".poster[data-need]") ? [root] : root.querySelectorAll(".poster[data-need]");
  for (const s of list) queue.add(s);
  work();
}
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) scan(n) }).observe(document.body, {childList: true, subtree: true});
scan(document.body);
