// Abgleich mit Trakt über den Worker: gesehene Filme und Serien-Stand übernehmen
import { S, P, save, touch, emit } from "./state.js";
import { workerApi } from "./api.js";
import { backfill } from "./data.js";

export async function traktImport(){
  const d = await workerApi("/api/trakt/watched");
  const pd = P();
  let movies = 0, shows = 0;
  for (const m of d.movies || []){
    const key = "movie:" + m.tmdb;
    if (pd.watched[key]) continue;
    pd.watched[key] = {key, type: "movie", id: m.tmdb, title: m.title, year: String(m.year || ""), poster: null, t: Date.parse(m.at) || Date.now(), stars: 0, like: 0};
    movies++;
  }
  for (const s of d.shows || []){
    if (!s.last) continue;
    const key = "tv:" + s.tmdb, cur = pd.progress[key];
    if (!cur || s.last.s > cur.s || (s.last.s === cur.s && s.last.e > cur.e)){ pd.progress[key] = {s: s.last.s, e: s.last.e, t: Date.now()}; shows++ }
    if (!pd.follow[key]) pd.follow[key] = {key, type: "tv", id: s.tmdb, title: s.title, year: String(s.year || ""), poster: null, t: Date.now()};
  }
  S.meta.__traktLast = Date.now(); save("meta");
  if (movies || shows){ touch(); emit("watched"); emit("follow"); backfill(80) }
  return {movies, shows};
}
