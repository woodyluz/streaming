// Anbieter, Status, Listen, Gesehen, Folgen: alles, was mit den Daten des aktiven Profils arbeitet.
import { S, P, touch, emit, save } from "./state.js";
import { tmdb, regions } from "./api.js";
import { H, SA_MAP } from "./constants.js";
import { normName, titleOf, yearOf } from "./util.js";

export const MINE_NAMES = new Map();
export async function providerList(){
  const opt = {watch_region: S.country};
  const [m, t] = await Promise.all([tmdb("/watch/providers/movie", opt, 72 * H), tmdb("/watch/providers/tv", opt, 72 * H)]);
  const map = new Map();
  for (const p of [...m.results, ...t.results]) if (!map.has(p.provider_id)){ map.set(p.provider_id, p); MINE_NAMES.set(p.provider_id, p.provider_name) }
  return [...map.values()].sort((a, b) => (a.display_priorities?.[S.country] ?? 999) - (b.display_priorities?.[S.country] ?? 999));
}
export async function genreMap(type){
  const d = await tmdb(`/genre/${type}/list`, {}, 168 * H);
  return new Map(d.genres.map(g => [g.id, g.name]));
}
export const saCatalogs = () => [...new Set(S.mine.map(id => SA_MAP[normName(MINE_NAMES.get(id))]).filter(Boolean))];

export const flatOf = r => r ? [...(r.flatrate || []), ...(r.free || []), ...(r.ads || [])] : [];
export function statusOf(r){
  const flat = flatOf(r);
  const mine = flat.filter(p => S.mine.includes(p.provider_id));
  const names = list => [...new Set(list.map(p => p.provider_name))];
  if (mine.length) return {kind: "mine", text: "Bei " + names(mine).slice(0, 2).join(", "), names: names(mine)};
  if (flat.length) return {kind: "flat", text: "Im Abo: " + flat[0].provider_name + (flat.length > 1 ? " +" + (flat.length - 1) : ""), names: [flat[0].provider_name]};
  if (r && ((r.rent || []).length || (r.buy || []).length)) return {kind: "pay", text: "Leihen oder kaufen", names: []};
  return {kind: "none", text: "Nicht verfügbar", names: []};
}

/* ---------- bekannte Titel ---------- */
export const ITEMS = new Map();
export function remember(it){
  const type = it.media_type || it.type, key = type + ":" + it.id;
  const prev = ITEMS.get(key) || {};
  ITEMS.set(key, {key, type, id: +it.id, title: titleOf(it) || prev.title || "", poster: it.poster_path || it.poster || prev.poster || null,
    posterUrl: it.posterUrl || prev.posterUrl || null, year: yearOf(it) || prev.year || ""});
  // Angaben fürs Sortieren und Filtern der Listen merken (nur lokal)
  if (it.vote_average !== undefined || it.genre_ids || it.genres || it.runtime){
    const m = S.meta[key] || {};
    if (it.vote_average !== undefined) m.va = it.vote_average;
    if (it.runtime || it.episode_run_time?.[0]) m.rt = it.runtime || it.episode_run_time[0];
    if (it.genres) m.g = it.genres.map(g => g.name);
    if (it.genre_ids && !m.gids) m.gids = it.genre_ids;
    S.meta[key] = m;
  }
  return key;
}

/* ---------- Listen ---------- */
export function listItems(pd = P()){
  const m = new Map();
  for (const l of pd.lists) for (const i of l.items) if (!m.has(i.key)) m.set(i.key, i);
  return [...m.values()];
}
export const isSaved = key => P().lists.some(l => l.items.some(i => i.key === key));
export const inList = (l, key) => l.items.some(i => i.key === key);
export const listCount = key => P().lists.filter(l => inList(l, key)).length;

export function setInList(listId, key, on){
  const pd = P(), l = pd.lists.find(x => x.id === listId);
  if (!l) return;
  const has = inList(l, key);
  if (on && !has){
    const it = ITEMS.get(key); if (!it) return;
    l.items.unshift({...it, added: Date.now()});
    if (!S.track[key]) regions([{type: it.type, id: it.id}]).then(m => {
      S.track[key] = {f: flatOf(m.get(key)).map(p => p.provider_id), c: S.country, n: false}; save("track");
    }).catch(() => {});
  }
  if (!on && has){ l.items = l.items.filter(i => i.key !== key); pd.tomb.items[l.id + "|" + key] = Date.now() }
  touch(); emit("saved", key);
}
export function newList(name){
  const l = {id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name.trim().slice(0, 40) || "Neue Liste", nt: Date.now(), items: []};
  P().lists.push(l); touch();
  return l;
}
export function renameList(id, name){
  const l = P().lists.find(x => x.id === id); if (!l) return;
  l.name = name.trim().slice(0, 40) || l.name; l.nt = Date.now(); touch();
}
export function deleteList(id){
  const pd = P();
  if (pd.lists.length < 2) return;
  pd.tomb.lists[id] = Date.now();
  pd.lists = pd.lists.filter(l => l.id !== id);
  touch();
}

/* ---------- Gesehen, Bewertung, Folgen, Fortschritt ---------- */
export function setWatched(key, on){
  const pd = P();
  if (on){ const it = ITEMS.get(key); pd.watched[key] = {...(it || {}), key, t: Date.now(), like: pd.watched[key]?.like || 0} }
  else { delete pd.watched[key]; pd.tomb.watched[key] = Date.now() }
  touch(); emit("watched", key);
}
export function setLike(key, v){
  const w = P().watched[key]; if (!w) return;
  w.like = w.like === v ? 0 : v; w.t = Date.now(); touch(); emit("watched", key);
}
export const isFollowed = key => !!P().follow[key];
export function setFollow(key, on){
  const pd = P();
  if (on){ const it = ITEMS.get(key); pd.follow[key] = {...(it || {key, type: "tv", id: +key.split(":")[1]}), key, t: Date.now()} }
  else { delete pd.follow[key]; pd.tomb.follow[key] = Date.now() }
  touch(); emit("follow", key);
}
export function setProgress(key, pr){
  const pd = P();
  if (pr){ pd.progress[key] = {...pr, t: Date.now()}; if (!pd.follow[key]) setFollow(key, true) }
  else { delete pd.progress[key]; pd.tomb.progress[key] = Date.now() }
  touch();
}
// Serien für den Kalender: gefolgt, angefangen und auf Wunsch aus den Listen
export function followedSeries(includeLists = true){
  const pd = P(), m = new Map();
  for (const [k, v] of Object.entries(pd.follow)) m.set(k, v);
  for (const k of Object.keys(pd.progress)) if (k.startsWith("tv:") && !m.has(k)) m.set(k, pd.watched[k] || ITEMS.get(k) || {key: k, type: "tv", id: +k.split(":")[1]});
  if (includeLists) for (const i of listItems()) if (i.type === "tv" && !m.has(i.key)) m.set(i.key, i);
  return [...m.values()];
}
