// Alle Abfragen an TMDB, Streaming Availability und OMDb, direkt oder über den eigenen Worker.
import { S, proxyBase } from "./state.js";
import { API, SA_HOST, H, JOBS } from "./constants.js";
import { cget, cset } from "./cache.js";
import { pool, titleOf } from "./util.js";

const inflight = new Map();
async function once(k, fn){
  if (inflight.has(k)) return inflight.get(k);
  const p = fn();
  inflight.set(k, p);
  try { return await p } finally { inflight.delete(k) }
}
export const authHeader = () => S.sync ? {Authorization: "Bearer " + S.sync} : {};

function httpError(status, where){
  if (status === 401) return new Error(where === "tmdb" ? "Der TMDB-Schlüssel wurde abgelehnt. Bitte prüfe ihn in den Einstellungen." : "Zugang abgelehnt.");
  if (status === 403) return new Error("Der Worker lässt diese Anfrage nicht zu. Öffne Streamfinder über deine eigene Adresse oder verbinde dieses Gerät unter Einstellungen → Geräte synchronisieren.");
  if (status === 429) return new Error("Zu viele Anfragen. Warte einen Moment und versuche es erneut.");
  return new Error(`Der Dienst antwortet mit Fehler ${status}. Versuche es gleich nochmal.`);
}

/* ---------- TMDB ---------- */
export async function tmdb(path, params = {}, ttl = 6 * H){
  const url = new URL((S.proxy ? proxyBase() + "/3" : API) + path);
  url.searchParams.set("language", "de-DE");
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) url.searchParams.set(k, v);
  const ck = "t:" + path + url.search;
  if (ttl){ const c = await cget(ck, ttl); if (c !== undefined) return c }
  return once(ck, async () => {
    const headers = {};
    if (!S.proxy){ if (S.key.length > 40) headers.Authorization = "Bearer " + S.key; else url.searchParams.set("api_key", S.key) }
    let res;
    try { res = await fetch(url, {headers}) }
    catch(e){ throw new Error(S.proxy ? "Der Worker ist nicht erreichbar. Prüfe die Adresse in config.js." : "Keine Verbindung zu TMDB. Prüfe deine Internetverbindung.") }
    if (!res.ok) throw httpError(res.status, "tmdb");
    const d = await res.json();
    if (ttl) cset(ck, d);
    return d;
  });
}

const CERT_COUNTRIES = ["DE", "CH", "AT"];
export const certNum = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n <= 18 ? n : null };
function certFrom(d, type){
  for (const cc of CERT_COUNTRIES){
    const v = type === "movie"
      ? (d.release_dates?.results || []).find(r => r.iso_3166_1 === cc)?.release_dates?.map(x => certNum(x.certification)).find(n => n !== null)
      : certNum((d.content_ratings?.results || []).find(r => r.iso_3166_1 === cc)?.rating);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}
const ep = e => e ? {date: e.air_date, s: e.season_number, e: e.episode_number, name: e.name} : null;

// Alles, was die Detailansicht braucht, gekürzt für den Zwischenspeicher
export async function titleFull(type, id){
  const keep = [S.country, ...S.compare];
  const ck = `full:${type}:${id}:${keep.join(",")}`;
  const c = await cget(ck, 6 * H); if (c !== undefined) return c;
  return once(ck, async () => {
    const extra = type === "movie" ? "release_dates" : "content_ratings";
    const d = await tmdb(`/${type}/${id}`, {append_to_response: `videos,watch/providers,credits,external_ids,recommendations,${extra}`, include_video_language: "de,en,null"}, 0);
    const prov = {};
    for (const [k, v] of Object.entries(d["watch/providers"]?.results || {})) if (keep.includes(k)) prov[k] = v;
    const crewJobs = ["Director", "Screenplay", "Writer", "Novel", "Story", "Author", "Original Story", "Teleplay", "Characters"];
    const t = {
      id: d.id, media_type: type, title: titleOf(d), poster_path: d.poster_path, release_date: d.release_date, first_air_date: d.first_air_date,
      runtime: d.runtime, episode_run_time: d.episode_run_time, number_of_seasons: d.number_of_seasons, status: d.status,
      seasons: (d.seasons || []).filter(s => s.season_number > 0 && s.episode_count > 0).map(s => ({n: s.season_number, c: s.episode_count})),
      next: ep(d.next_episode_to_air), last: ep(d.last_episode_to_air), networks: (d.networks || []).map(n => n.name),
      genres: d.genres || [], vote_average: d.vote_average, vote_count: d.vote_count, overview: d.overview,
      imdb: d.external_ids?.imdb_id || d.imdb_id || "", fsk: certFrom(d, type),
      created_by: (d.created_by || []).map(p => ({id: p.id, name: p.name})),
      cast: (d.credits?.cast || []).slice(0, 12).map(p => ({id: p.id, name: p.name, character: p.character, profile_path: p.profile_path})),
      crew: (d.credits?.crew || []).filter(p => crewJobs.includes(p.job)).slice(0, 10).map(p => ({id: p.id, name: p.name, job: p.job})),
      videos: (d.videos?.results || []).filter(v => v.site === "YouTube").slice(0, 6).map(v => ({key: v.key, type: v.type, lang: v.iso_639_1})),
      recs: (d.recommendations?.results || []).slice(0, 14).map(r => ({id: r.id, media_type: r.media_type || type, title: titleOf(r), poster_path: r.poster_path,
        release_date: r.release_date || r.first_air_date, vote_average: r.vote_average, vote_count: r.vote_count, genre_ids: r.genre_ids || []})),
      providers: prov
    };
    cset(ck, t);
    cset(`cert:${type}:${id}`, t.fsk);
    return t;
  });
}

// Nur die Altersfreigabe (kleine Abfrage), 7 Tage gültig
export async function certOf(type, id){
  const ck = `cert:${type}:${id}`;
  const c = await cget(ck, 168 * H); if (c !== undefined) return c;
  return once(ck, async () => {
    const d = await tmdb(type === "movie" ? `/movie/${id}/release_dates` : `/tv/${id}/content_ratings`, {}, 0);
    const v = certFrom(type === "movie" ? {release_dates: d} : {content_ratings: d}, type);
    cset(ck, v);
    return v;
  });
}

export async function personFull(id){
  const ck = `person:${id}`;
  const c = await cget(ck, 24 * H); if (c !== undefined) return c;
  return once(ck, async () => {
    const d = await tmdb(`/person/${id}`, {append_to_response: "combined_credits"}, 0);
    const skip = [10767, 10763]; // Talkshows, Nachrichten
    const pack = (list, role) => {
      const map = new Map();
      for (const x of list || []){
        if (x.media_type !== "movie" && x.media_type !== "tv") continue;
        if ((x.genre_ids || []).some(g => skip.includes(g))) continue;
        const k = x.media_type + ":" + x.id, r = role(x), prev = map.get(k);
        if (prev){ if (r && !prev.role.includes(r)) prev.role += ", " + r; continue }
        map.set(k, {id: x.id, media_type: x.media_type, title: titleOf(x), poster_path: x.poster_path, genre_ids: x.genre_ids, vote_average: x.vote_average,
          release_date: x.release_date || x.first_air_date, popularity: x.popularity || 0, role: r || ""});
      }
      return [...map.values()].sort((a, b) => b.popularity - a.popularity);
    };
    const p = {id: d.id, name: d.name, profile_path: d.profile_path, dept: d.known_for_department, birthday: d.birthday,
      deathday: d.deathday, place: d.place_of_birth, bio: d.biography,
      cast: pack(d.combined_credits?.cast, x => x.character), crew: pack(d.combined_credits?.crew, x => JOBS[x.job] || x.job)};
    cset(ck, p);
    return p;
  });
}

/* ---------- Verfügbarkeit, gebündelt ---------- */
let batchOff = false;
const BATCH = 15;
const regionKey = (cc, type, id) => `wp:${cc}:${type}:${id}`;

// Liefert eine Map "type:id" → Anbieter-Objekt der aktuellen Region (oder null)
export async function regions(items){
  const cc = S.country, out = new Map(), miss = [];
  const uniq = [...new Map(items.map(i => [i.type + ":" + i.id, i])).values()];
  await Promise.all(uniq.map(async it => {
    const v = await cget(regionKey(cc, it.type, it.id), 6 * H);
    if (v !== undefined) out.set(it.type + ":" + it.id, v); else miss.push(it);
  }));
  if (!miss.length) return out;
  const single = async it => {
    try {
      const d = await tmdb(`/${it.type}/${it.id}/watch/providers`, {}, 0);
      const r = (d.results || {})[cc] || null;
      cset(regionKey(cc, it.type, it.id), r); out.set(it.type + ":" + it.id, r);
    } catch(e){}
  };
  if (S.proxy && !batchOff){
    const chunks = [];
    for (let i = 0; i < miss.length; i += BATCH) chunks.push(miss.slice(i, i + BATCH));
    await pool(chunks, 3, async chunk => {
      try {
        const res = await fetch(`${proxyBase()}/batch/providers?region=${cc}&ids=${chunk.map(i => i.type + ":" + i.id).join(",")}`);
        if (res.status === 404){ batchOff = true; throw new Error("kein Batch") }
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        for (const it of chunk){
          const k = it.type + ":" + it.id;
          if (k in d){ cset(regionKey(cc, it.type, it.id), d[k]); out.set(k, d[k]) }
        }
      } catch(e){ await pool(chunk.filter(i => !out.has(i.type + ":" + i.id)), 4, single) }
    });
  } else await pool(miss, 6, single);
  return out;
}
export async function regionOf(type, id){
  return (await regions([{type, id: +id}])).get(type + ":" + id);
}

/* ---------- Streaming Availability ---------- */
export const SA = {off: false, needsLink: false};
export const saReady = () => !SA.off && !!(S.sa || S.proxy);
export async function saGet(pathQuery, ttl = 24 * H){
  const ck = "sa:" + pathQuery;
  if (ttl){ const c = await cget(ck, ttl); if (c !== undefined) return c }
  return once(ck, async () => {
    const direct = !!S.sa || !S.proxy;
    const url = direct ? `https://${SA_HOST}${pathQuery}` : proxyBase() + "/sa" + pathQuery;
    let res;
    try { res = await fetch(url, {headers: direct ? {"X-RapidAPI-Key": S.sa, "X-RapidAPI-Host": SA_HOST} : authHeader()}) }
    catch(e){ throw new Error("Streaming Availability ist nicht erreichbar.") }
    if (res.status === 501){ SA.off = true; throw new Error("off") }
    if (!direct && res.status === 401){ SA.off = true; SA.needsLink = true; throw new Error("off") }
    if (res.status === 404){ const d = {streamingOptions: {}, changes: [], shows: {}}; if (ttl) cset(ck, d); return d }
    if (res.status === 401 || res.status === 403) throw new Error("Der RapidAPI-Schlüssel wurde abgelehnt. Hast du die Streaming Availability API bei RapidAPI abonniert (Basic-Plan)?");
    if (res.status === 429) throw new Error("Das Kontingent von Streaming Availability ist aufgebraucht. Später geht es wieder.");
    if (!res.ok) throw new Error("Streaming Availability antwortet mit Fehler " + res.status + ".");
    const d = await res.json();
    if (ttl) cset(ck, d);
    return d;
  });
}
export const saShow = (type, id, ttl) => saGet(`/shows/${type}/${id}?country=${S.country.toLowerCase()}`, ttl);
export function saChanges(kind, cats){
  if (!cats.length) return Promise.resolve(null);
  const q = new URLSearchParams({change_type: kind, item_type: "show", country: S.country.toLowerCase(), catalogs: cats.join(","),
    order_direction: kind === "new" ? "desc" : "asc"});
  if (kind !== "new") q.set("include_unknown_dates", "false");
  return saGet("/changes?" + q, 12 * H);
}

/* ---------- OMDb ---------- */
export const OM = {off: false};
export const omReady = () => !OM.off && !!(S.omdb || S.proxy);
export async function omdb(imdb, ttl = 168 * H){
  const ck = "om:" + imdb;
  if (ttl){ const c = await cget(ck, ttl); if (c !== undefined) return c }
  const direct = !!S.omdb;
  const url = direct ? `https://www.omdbapi.com/?i=${encodeURIComponent(imdb)}&apikey=${encodeURIComponent(S.omdb)}` : proxyBase() + "/omdb?i=" + encodeURIComponent(imdb);
  const res = await fetch(url, {headers: direct ? {} : authHeader()});
  if (res.status === 501 || (!direct && res.status === 401)){ OM.off = true; throw new Error("off") }
  if (res.status === 401) throw new Error("Der OMDb-Schlüssel wurde abgelehnt.");
  const d = await res.json();
  if (d.Response === "False" && /key/i.test(d.Error || "")) throw new Error("Der OMDb-Schlüssel wurde abgelehnt.");
  if (ttl) cset(ck, d);
  return d;
}
