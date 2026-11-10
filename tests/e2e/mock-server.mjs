// Testserver: liefert public/ aus und spielt den Worker mit festen Testdaten nach.
// Start: node tests/e2e/mock-server.mjs   (Port 4173, oder PORT=…)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../public");
const PORT = +process.env.PORT || 4173;
const TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json"};
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const fsk = id => id % 3 === 0 ? 16 : 6;
const movie = id => ({id, title: `Film ${id}`, original_title: `Film ${id}`, poster_path: null, release_date: "2024-03-01", vote_average: 5 + (id % 5), vote_count: 900,
  genre_ids: id % 2 ? [35] : [18], overview: "Eine Geschichte.", popularity: 200 - id, media_type: "movie"});
const tv = id => ({id, name: `Serie ${id}`, original_name: `Serie ${id}`, poster_path: null, first_air_date: "2023-01-01", vote_average: 7.5, vote_count: 500,
  genre_ids: [18], overview: "Eine Serie.", popularity: 100 - id, media_type: "tv"});
const NETFLIX = {provider_id: 8, provider_name: "Netflix", logo_path: "/n.png", display_priority: 1};
const APPLE = {provider_id: 2, provider_name: "Apple TV", logo_path: "/a.png", display_priority: 2};
const region = id => id % 2 === 0 ? {link: "https://example.org/w", flatrate: [NETFLIX]} : {link: "https://example.org/w", rent: [APPLE]};
const genres = [{id: 18, name: "Drama"}, {id: 35, name: "Komödie"}];

function full(type, id){
  const base = type === "movie" ? movie(id) : tv(id);
  const d = {...base, poster_path: id === 13 ? null : `/p${id}.jpg`, genres: id % 2 ? [genres[1]] : [genres[0]], videos: {results: [{site: "YouTube", type: "Trailer", key: "abc", iso_639_1: "de"}]},
    "watch/providers": {results: {CH: region(id), DE: region(id + 1)}}, external_ids: {imdb_id: "tt" + (1000 + id)},
    credits: {cast: [{id: 500, name: "Anna Muster", character: "Heldin", profile_path: null}, {id: 600 + id, name: `Person ${id}`, character: "Nebenrolle"}],
      crew: [{id: 900, name: "Rita Regie", job: "Director"}]},
    recommendations: {results: [10, 11, 12, 13].map(k => (type === "movie" ? movie : tv)(id + k))}};
  if (type === "movie") Object.assign(d, {runtime: 90 + id, release_dates: {results: [{iso_3166_1: "DE", release_dates: [{certification: String(fsk(id))}]}]}});
  else Object.assign(d, {seasons: [{season_number: 0, episode_count: 2}, {season_number: 1, episode_count: 6}, {season_number: 2, episode_count: 8}],
    number_of_seasons: 2, episode_run_time: [45], status: "Returning Series", networks: [{name: "HBO"}], created_by: [{id: 901, name: "Ida Idee"}],
    next_episode_to_air: {air_date: day(2), season_number: 2, episode_number: 5, name: "Der Plan"},
    last_episode_to_air: {air_date: day(-5), season_number: 2, episode_number: 4, name: "Folge 4"},
    content_ratings: {results: [{iso_3166_1: "DE", rating: String(fsk(id))}]}});
  return d;
}

function tmdb(path, q){
  if (path === "/configuration") return {};
  if (path.startsWith("/watch/providers/")) return {results: [NETFLIX, APPLE, {provider_id: 337, provider_name: "Disney Plus", logo_path: "/d.png"}].map(p => ({...p, display_priorities: {CH: p.provider_id}}))};
  if (path.startsWith("/genre/")) return {genres};
  let m;
  if ((m = path.match(/^\/discover\/(movie|tv)$/))){
    const type = m[1], page = +q.get("page") || 1, max = q.get("certification.lte");
    let ids = Array.from({length: 20}, (_, i) => (page - 1) * 20 + i + 1);
    if (max !== null) ids = ids.filter(id => fsk(id) <= +max);
    return {results: ids.map(type === "movie" ? movie : tv), total_pages: 3, total_results: 60};
  }
  if (path === "/search/multi" || path === "/search/movie" || path === "/search/tv"){
    const query = (q.get("query") || "").toLowerCase();
    const n = query.match(/^(film|serie) (\d+)$/);
    if (n) return {results: n[1] === "film" ? [movie(+n[2]), movie(+n[2] * 10)] : [tv(+n[2])]};
    if (query.includes("anna")) return {results: [{id: 500, media_type: "person", name: "Anna Muster", popularity: 5, profile_path: null, known_for_department: "Acting"}, movie(7)]};
    if (query === "film") return {results: [movie(7), movie(8)]};
    return {results: []};
  }
  if (path === "/movie/now_playing") return {results: [movie(4), movie(30)], total_pages: 1};
  if ((m = path.match(/^\/find\/tt(\d+)$/))) return {movie_results: [movie(+m[1] - 1000)], tv_results: []};
  if (path === "/person/500") return {id: 500, name: "Anna Muster", known_for_department: "Acting", birthday: "1980-05-01", place_of_birth: "Zürich", biography: "Schauspielerin aus Zürich.",
    combined_credits: {cast: [{...movie(4), character: "Heldin"}, {...tv(2), character: "Gast"}, {...tv(9), character: "Gast", genre_ids: [10767]}], crew: [{...movie(5), job: "Screenplay"}]}};
  if ((m = path.match(/^\/(movie|tv)\/(\d+)\/watch\/providers$/))) return {results: {CH: region(+m[2])}};
  if ((m = path.match(/^\/movie\/(\d+)\/release_dates$/))) return {results: [{iso_3166_1: "DE", release_dates: [{certification: String(fsk(+m[1]))}]}]};
  if ((m = path.match(/^\/tv\/(\d+)\/content_ratings$/))) return {results: [{iso_3166_1: "DE", rating: String(fsk(+m[1]))}]};
  if ((m = path.match(/^\/(movie|tv)\/(\d+)\/images$/))) return {posters: +m[2] === 13 ? [{file_path: "/p13-alt.jpg"}] : []};
  if ((m = path.match(/^\/(movie|tv)\/(\d+)$/))) return full(m[1], +m[2]);
  return null;
}

const SA_SHOW = {streamingOptions: {ch: [{service: {id: "netflix", name: "Netflix", imageSet: {}}, type: "subscription", link: "https://netflix.example/t", quality: "hd",
  expiresSoon: true, expiresOn: Math.floor(Date.now() / 1000) + 5 * 86400, audios: [{language: "deu"}, {language: "eng"}], subtitles: [{locale: {language: "deu"}}]}]}};
const SA_CHANGES = {changes: [{showId: "s1", service: {id: "netflix", name: "Netflix"}, timestamp: Math.floor(Date.now() / 1000) + 4 * 86400},
  {showId: "s2", service: {id: "netflix", name: "Netflix"}, timestamp: Math.floor(Date.now() / 1000) + 6 * 86400}],
  shows: {s1: {tmdbId: "movie/4", title: "Film 4", releaseYear: 2024, imageSet: {}, streamingOptions: {ch: [{service: {id: "netflix"}, audios: [{language: "deu"}]}]}},
    s2: {tmdbId: "tv/6", title: "Serie 6", firstAirYear: 2023, imageSet: {}, streamingOptions: {ch: [{service: {id: "netflix"}, audios: [{language: "eng"}]}]}}}};

let synced = null, votes = {}, shares = {}, backups = {}, collabs = {};
const rid = () => Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7);
const readBody = async req => { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : null };
const SECRET = "geheim";
const json = (res, data, status = 200) => { res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-store"}); res.end(JSON.stringify(data)) };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`), p = url.pathname;
  const authed = req.headers.authorization === "Bearer " + SECRET;
  try {
    if (p === "/config.js"){ res.writeHead(200, {"Content-Type": "text/javascript"}); return res.end("window.STREAMFINDER_CONFIG={proxy:location.origin}") }
    if (p === "/__reset"){ synced = null; votes = {}; shares = {}; backups = {}; collabs = {}; return json(res, {ok: true}) }
    if (p.startsWith("/3/")){ const d = tmdb(p.slice(2), url.searchParams); return d ? json(res, d) : json(res, {status_message: "nicht gefunden"}, 404) }
    if (p === "/batch/providers"){
      const out = {};
      for (const k of (url.searchParams.get("ids") || "").split(",").slice(0, 15)){ const [, id] = k.split(":"); out[k] = region(+id) }
      return json(res, out);
    }
    if (p.startsWith("/sa/")){ if (!authed) return json(res, "nein", 401); return json(res, p.startsWith("/sa/changes") ? SA_CHANGES : SA_SHOW) }
    if (p === "/omdb"){ if (!authed) return json(res, "nein", 401); return json(res, {Response: "True", Ratings: [{Source: "Internet Movie Database", Value: "8.1/10"}, {Source: "Rotten Tomatoes", Value: "94%"}]}) }
    let m;
    if ((m = p.match(/^\/api\/vote\/(\w{10})$/)) && req.method === "GET"){ const v = votes[m[1]]; return v ? json(res, {...v.doc, parts: Object.values(v.parts)}) : json(res, "weg", 404) }
    if ((m = p.match(/^\/api\/vote\/(\w{10})\/p\/(\w+)$/)) && req.method === "PUT"){ const b = await readBody(req); votes[m[1]].parts[m[2]] = {...b, pid: m[2]}; return json(res, {ok: true}) }
    if ((m = p.match(/^\/api\/share\/(\w{10})$/)) && req.method === "GET") return shares[m[1]] ? json(res, shares[m[1]]) : json(res, "weg", 404);
    if (p === "/api/mood") return json(res, "KI ist nicht eingerichtet", 501);
    if ((m = p.match(/^\/api\/collab\/(\w{12})$/)) && req.method === "GET") return collabs[m[1]] ? json(res, collabs[m[1]]) : json(res, "weg", 404);
    if ((m = p.match(/^\/api\/collab\/(\w{12})\/op$/)) && req.method === "POST"){
      const d = collabs[m[1]]; if (!d) return json(res, "weg", 404);
      const b = await readBody(req);
      if (b.op === "add" && !d.items.some(i => i.key === b.item.key)) d.items.unshift({...b.item, type: b.item.key.split(":")[0], id: +b.item.key.split(":")[1], added: Date.now()});
      if (b.op === "remove") d.items = d.items.filter(i => i.key !== b.key);
      d.v++; d.updated = Date.now(); return json(res, d);
    }
    if (p.startsWith("/api/")){
      if (!authed) return json(res, "Falsches Sync-Passwort", 401);
      if (p === "/api/vote" && req.method === "POST"){ const b = await readBody(req); const id = rid(); votes[id] = {doc: {id, title: b.title, host: b.host, items: b.items, closed: false}, parts: {}}; return json(res, {id}) }
      if (p === "/api/share" && req.method === "POST"){ const b = await readBody(req); const id = b.id || rid(); shares[id] = {...b, id, updated: Date.now()}; return json(res, {id}) }
      if (p === "/api/backups" && req.method === "POST"){ const id = new Date().toISOString().slice(0, 19); backups[id] = JSON.parse(JSON.stringify(synced)); return json(res, {id}) }
      if (p === "/api/backups" && req.method === "GET") return json(res, Object.keys(backups).sort().reverse());
      if ((m = p.match(/^\/api\/backups\/(.+)$/))) return json(res, backups[decodeURIComponent(m[1])]);
      if (p === "/api/collab" && req.method === "POST"){ const b = await readBody(req); const id = rid() + "ab"; collabs[id] = {id, title: b.title, items: b.items.map(i => ({...i, type: i.key.split(":")[0], id: +i.key.split(":")[1], added: Date.now()})), v: 1, updated: Date.now()}; return json(res, collabs[id]) }
      if ((m = p.match(/^\/api\/collab\/(\w{12})$/)) && req.method === "DELETE"){ delete collabs[m[1]]; return json(res, {ok: true}) }
      if (p.startsWith("/api/trakt")) return json(res, "Trakt ist nicht eingerichtet", 501);
      if (p === "/api/data" && req.method === "GET") return json(res, synced || {});
      if (p === "/api/data" && req.method === "PUT"){ let b = ""; for await (const c of req) b += c; synced = JSON.parse(b); return json(res, {ok: true}) }
      return json(res, {ok: true});
    }
    const file = normalize(join(ROOT, p === "/" ? "index.html" : p));
    if (!file.startsWith(ROOT)) return json(res, "nein", 403);
    const body = await readFile(file);
    res.writeHead(200, {"Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store"});
    res.end(body);
  } catch(e){ if (process.env.DEBUG) console.error(e); res.writeHead(404); res.end("nicht gefunden") }
}).listen(PORT, () => console.log(`Streamfinder-Testserver auf http://localhost:${PORT}`));
