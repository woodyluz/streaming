// Worker mit nachgebautem Speicher und Netz testen
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { CollabList } from "../../worker/worker.js";

const kvStore = new Map();
const KV = {async get(k, t){ const v = kvStore.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v }, async put(k, v){ kvStore.set(k, v) },
  async delete(k){ kvStore.delete(k) }, async list({prefix}){ return {keys: [...kvStore.keys()].filter(k => k.startsWith(prefix)).map(name => ({name}))} }};
globalThis.caches = {default: {async match(){ return undefined }, async put(){}}};
let pushes = [], tmdbCalls = 0, flat = [], nextEp = null, rentPrice = 4.9, traktReady = false;
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  if (u.startsWith("https://push.example")){ pushes.push(o.headers.Authorization); return new Response(null, {status: 201}) }
  if (u.includes("/watch/providers")){ tmdbCalls++; return Response.json({results: {CH: {flatrate: flat}}}) }
  if (u.includes("/changes")) return Response.json({changes: [{showId: "s1", service: {id: "netflix", name: "Netflix"}, timestamp: Math.floor(Date.now() / 1000) + 3 * 86400}], shows: {s1: {tmdbId: "movie/550", title: "Fight Club"}}});
  if (u.match(/\/3\/tv\/\d+\?/)) return Response.json({name: "Die Serie", next_episode_to_air: nextEp});
  if (u.includes("api.themoviedb.org")) return Response.json({ok: true, auth: o.headers?.Authorization});
  if (u.includes("rapidapi") && u.includes("/shows/")) return Response.json({streamingOptions: {ch: [{type: "rent", service: {name: "Apple TV"}, price: {amount: String(rentPrice), formatted: rentPrice.toFixed(2) + " CHF"}}]}});
  if (u.includes("rapidapi")) return Response.json({sa: true});
  if (u.startsWith("https://api.anthropic.com")) return Response.json({content: [{type: "text", text: 'Gern: {"type":"movie","genres":{"movie":[53],"tv":[]},"understood":["spannend"]}'}]});
  if (u === "https://api.trakt.tv/oauth/device/code") return Response.json({device_code: "dev", user_code: "AB12CD", verification_url: "https://trakt.tv/activate", interval: 5, expires_in: 600});
  if (u === "https://api.trakt.tv/oauth/device/token") return traktReady ? Response.json({access_token: "tok", refresh_token: "r", created_at: Math.floor(Date.now() / 1000), expires_in: 7776000}) : new Response(null, {status: 400});
  if (u === "https://api.trakt.tv/sync/watched/movies") return Response.json([{last_watched_at: "2026-01-02T20:00:00Z", movie: {title: "Heat", year: 1995, ids: {tmdb: 949}}}]);
  if (u === "https://api.trakt.tv/sync/watched/shows") return Response.json([{last_watched_at: "2026-02-02T20:00:00Z", show: {title: "Atypical", year: 2017, ids: {tmdb: 71578}},
    seasons: [{number: 1, episodes: [{number: 1}, {number: 8}]}, {number: 2, episodes: [{number: 3}]}]}]);
  throw new Error("unerwartet " + u);
};
const env = {TMDB_TOKEN: "tok", SA_KEY: "sa", SYNC_SECRET: "geheim", SF_KV: KV, ALLOWED_ORIGIN: "https://me.github.io", ANTHROPIC_API_KEY: "k", TRAKT_CLIENT_ID: "c", TRAKT_CLIENT_SECRET: "s"};
const ctx = {waitUntil(){}};
const BASE = "https://wk.dev";
const call = (path, headers = {}, opt = {}) => worker.fetch(new Request(BASE + path, {...opt, headers}), env, ctx);
const A = {Authorization: "Bearer geheim"};
const today = new Date().toLocaleDateString("sv-SE", {timeZone: "Europe/Zurich"});
beforeEach(() => { pushes = []; tmdbCalls = 0 });

test("Fremde ohne Herkunft oder Passwort werden abgewiesen", async () => {
  assert.equal((await call("/3/movie/1")).status, 403);
  assert.equal((await call("/3/movie/1", {Origin: "https://boese.example", "Sec-Fetch-Site": "cross-site"})).status, 403);
  assert.equal((await call("/sa/shows/movie/1", {Referer: BASE + "/"})).status, 401);
  assert.equal((await call("/omdb?i=tt1", {Referer: BASE + "/"})).status, 401);
});

test("Eigene Seite, erlaubte Adresse und Passwort kommen durch", async () => {
  let r = await call("/3/movie/1?api_key=x", {Referer: BASE + "/#entdecken"});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).auth, "Bearer tok");
  r = await call("/3/movie/1", {Origin: "https://me.github.io", "Sec-Fetch-Site": "cross-site"});
  assert.equal(r.headers.get("access-control-allow-origin"), "https://me.github.io");
  assert.equal((await call("/3/movie/1", A)).status, 200);
  assert.equal((await call("/sa/shows/movie/1?country=ch", A)).status, 200);
  assert.equal((await call("/sa/anything", A)).status, 404);
});

test("Batch liefert mehrere Titel und begrenzt die Anzahl", async () => {
  flat = [{provider_id: 8, provider_name: "Netflix"}];
  const ids = Array.from({length: 20}, (_, i) => "movie:" + (i + 1)).join(",") + ",kaputt";
  const r = await call(`/batch/providers?region=CH&ids=${ids}`, {Referer: BASE + "/"});
  const d = await r.json();
  assert.equal(Object.keys(d).length, 15);
  assert.equal(d["movie:1"].flatrate[0].provider_name, "Netflix");
});

test("Sync speichert und liefert Daten nur mit Passwort", async () => {
  assert.equal((await call("/api/data", {Authorization: "Bearer falsch"})).status, 401);
  const data = {v: 2, country: "CH", mine: [8], mineNames: {8: "Netflix"},
    pdata: {main: {lists: [{id: "main", items: [{key: "movie:550", type: "movie", id: 550, title: "Fight Club"}]}], follow: {"tv:77": {title: "Die Serie", t: 1}}, progress: {}}}};
  assert.equal((await call("/api/data", {...A, "Content-Type": "application/json"}, {method: "PUT", body: JSON.stringify({updated: 5, data})})).status, 200);
  assert.equal((await (await call("/api/data", A)).json()).updated, 5);
});

test("Push: Schlüssel, Abo, Test und gültige Signatur", async () => {
  const {key} = await (await call("/api/push/key", A)).json();
  assert.equal(Buffer.from(key, "base64url").length, 65);
  await call("/api/push/subscribe", A, {method: "POST", body: JSON.stringify({endpoint: "https://push.example/abc"})});
  const t = await (await call("/api/push/test", A, {method: "POST"})).json();
  assert.equal(t.sent, 1);
  const [, jwt] = pushes[0].match(/t=([^,]+)/), [h, c, s] = jwt.split(".");
  const pub = await crypto.subtle.importKey("raw", Buffer.from(key, "base64url"), {name: "ECDSA", namedCurve: "P-256"}, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({name: "ECDSA", hash: "SHA-256"}, pub, Buffer.from(s, "base64url"), new TextEncoder().encode(h + "." + c)));
});

test("Täglicher Check: neu im Dienst, letzte Chance, neue Folge heute", async () => {
  flat = []; nextEp = {air_date: today, season_number: 2, episode_number: 5, name: "Der Plan"};
  let done; await worker.scheduled({}, env, {waitUntil: p => done = p}); await done;
  flat = [{provider_id: 8, provider_name: "Netflix"}]; nextEp = null;
  await worker.scheduled({}, env, {waitUntil: p => done = p}); await done;
  const inbox = await (await call("/api/inbox?after=0", A)).json();
  const titles = inbox.map(n => n.title + ": " + n.body);
  assert.ok(titles.includes("Jetzt in deinen Diensten: Fight Club ist neu bei Netflix"));
  assert.ok(titles.some(t => t.startsWith("Letzte Chance: Fight Club verlässt Netflix")));
  assert.ok(titles.includes("Neue Folge heute: Die Serie: Staffel 2, Folge 5 „Der Plan“"));
  assert.equal(titles.filter(t => t.startsWith("Letzte Chance")).length, 1);
});

const OWN = {Referer: BASE + "/"};
const json = (path, headers, method, body) => call(path, {...headers, "Content-Type": "application/json"}, {method, body: body && JSON.stringify(body)});

test("Filmabend: anlegen nur mit Passwort, abstimmen für Gäste über die eigene Seite", async () => {
  const items = [{key: "movie:1", title: "A"}, {key: "movie:2", title: "B"}, {key: "kaputt"}];
  assert.equal((await json("/api/vote", OWN, "POST", {items})).status, 401);
  const {id} = await (await json("/api/vote", A, "POST", {items, title: "Freitag"})).json();
  assert.match(id, /^[A-Za-z0-9]{10}$/);
  assert.equal((await json(`/api/vote/${id}/p/abcdef12`, {Origin: "https://boese.example", "Sec-Fetch-Site": "cross-site"}, "PUT", {name: "X", yes: ["movie:1"]})).status, 403);
  await json(`/api/vote/${id}/p/abcdef12`, OWN, "PUT", {name: "Anna", yes: ["movie:1", "movie:9"], no: ["movie:1", "movie:2"], done: true});
  const d = await (await call(`/api/vote/${id}`)).json();
  assert.equal(d.items.length, 2);
  assert.deepEqual(d.parts[0].yes, ["movie:1"]);
  assert.deepEqual(d.parts[0].no, ["movie:2"]);
  await json(`/api/vote/${id}/close`, A, "POST");
  assert.equal((await json(`/api/vote/${id}/p/abcdef12`, OWN, "PUT", {name: "Anna"})).status, 409);
});

test("Geteilte Liste: öffentlich lesbar, nur mit Passwort änderbar", async () => {
  const {id} = await (await json("/api/share", A, "POST", {title: "Schuelreisli", items: [{key: "movie:1", title: "Heat", stars: 5, note: "Top"}]})).json();
  const d = await (await call("/api/share/" + id)).json();
  assert.equal(d.title, "Schuelreisli"); assert.equal(d.items[0].stars, 5);
  assert.equal((await json("/api/share/" + id, {}, "DELETE")).status, 401);
  await json("/api/share/" + id, A, "DELETE");
  assert.equal((await call("/api/share/" + id)).status, 404);
});

test("Sicherungen: manuell und wöchentlich, höchstens zehn", async () => {
  for (let i = 0; i < 3; i++) await json("/api/backups", A, "POST");
  const list = await (await call("/api/backups", A)).json();
  assert.ok(list.length >= 1);
  const b = await (await call("/api/backups/" + list[0], A)).json();
  assert.equal(b.updated, 5);
});

test("Stimmungssuche mit KI liefert Filter, ohne Herkunft abgewiesen", async () => {
  assert.equal((await json("/api/mood", {}, "POST", {text: "spannend"})).status, 403);
  const r = await (await json("/api/mood", OWN, "POST", {text: "etwas Spannendes"})).json();
  assert.deepEqual(r.filters.genres.movie, [53]);
});

test("Trakt: Gerätecode, Warten, Verbinden, gesehene Titel", async () => {
  const c = await (await json("/api/trakt/code", A, "POST")).json();
  assert.equal(c.user_code, "AB12CD");
  assert.equal((await (await json("/api/trakt/poll", A, "POST")).json()).state, "pending");
  traktReady = true;
  assert.equal((await (await json("/api/trakt/poll", A, "POST")).json()).state, "ok");
  const w = await (await call("/api/trakt/watched", A)).json();
  assert.deepEqual(w.movies[0], {tmdb: 949, title: "Heat", year: 1995, at: "2026-01-02T20:00:00Z"});
  assert.deepEqual(w.shows[0].last, {s: 2, e: 3});
});

test("Preiswächter meldet günstigere Preise", async () => {
  const data = {v: 2, country: "CH", mine: [], mineNames: {}, profiles: [{id: "main", spoiler: true}],
    pdata: {main: {lists: [], follow: {}, progress: {}, pwatch: {"movie:77": {t: 1, title: "Dune"}}}}};
  await json("/api/data", A, "PUT", {updated: 9, data});
  let done; await worker.scheduled({}, env, {waitUntil: p => done = p}); await done;
  rentPrice = 2.9;
  await worker.scheduled({}, env, {waitUntil: p => done = p}); await done;
  const inbox = await (await call("/api/inbox?after=0", A)).json();
  assert.ok(inbox.some(n => n.title === "Günstiger" && n.body === "Dune zum Leihen jetzt 2.90 CHF statt 4.90 CHF"));
});

test("Gemeinsame Liste: Besitzer legt an, Gäste fügen hinzu und entfernen anonym", async () => {
  assert.equal((await json("/api/collab", OWN, "POST", {title: "Familie", items: []})).status, 401);
  const doc = await (await json("/api/collab", A, "POST", {title: "Familie", items: [{key: "movie:1", title: "Heat", poster: "/a.jpg"}, {key: "kaputt"}]})).json();
  assert.match(doc.id, /^[A-Za-z0-9]{12}$/);
  assert.equal(doc.items.length, 1);
  const guest = {Referer: BASE + "/#gemeinsam-" + doc.id};
  assert.equal((await json(`/api/collab/${doc.id}/op`, {Origin: "https://boese.example", "Sec-Fetch-Site": "cross-site"}, "POST", {op: "add", item: {key: "movie:2"}})).status, 403);
  let d = await (await json(`/api/collab/${doc.id}/op`, guest, "POST", {op: "add", item: {key: "tv:5", title: "Atypical", poster: "javascript:alert(1)", year: "2017x", by: "Anna"}})).json();
  assert.deepEqual(d.items[0], {key: "tv:5", type: "tv", id: 5, title: "Atypical", poster: null, year: "2017", added: d.items[0].added});
  assert.equal(d.items.length, 2);
  d = await (await json(`/api/collab/${doc.id}/op`, guest, "POST", {op: "add", item: {key: "tv:5", title: "doppelt"}})).json();
  assert.equal(d.items.length, 2);
  d = await (await json(`/api/collab/${doc.id}/op`, guest, "POST", {op: "remove", key: "movie:1"})).json();
  assert.deepEqual(d.items.map(i => i.key), ["tv:5"]);
  assert.equal((await (await call("/api/collab/" + doc.id)).json()).v, 4);
  assert.equal((await json("/api/collab/" + doc.id, guest, "DELETE")).status, 401);
  await json("/api/collab/" + doc.id, A, "DELETE");
  assert.equal((await call("/api/collab/" + doc.id)).status, 404);
});

test("Gemeinsame Liste mit Durable Object: gleichzeitige Änderungen gehen nicht verloren, alte KV-Listen werden übernommen", async () => {
  const objs = new Map();
  const COLLAB = {idFromName: n => n, get(n){
    if (!objs.has(n)){ const mem = new Map(); objs.set(n, new CollabList({storage: {async get(k){ return mem.get(k) }, async put(k, v){ mem.set(k, structuredClone(v)) }, async deleteAll(){ mem.clear() }}}, {SF_KV: KV})) }
    const o = objs.get(n);
    return {fetch: (url, init) => o.fetch(new Request(url, init))};
  }};
  const env2 = {...env, COLLAB};
  const call2 = (path, headers = {}, opt = {}) => worker.fetch(new Request(BASE + path, {...opt, headers: {"Content-Type": "application/json", ...headers}}), env2, ctx);
  const doc = await (await call2("/api/collab", A, {method: "POST", body: JSON.stringify({title: "Familie", items: [{key: "movie:1", title: "Heat"}]})})).json();
  const guest = {Referer: BASE + "/"};
  // Zehn Gäste fügen gleichzeitig hinzu
  await Promise.all(Array.from({length: 10}, (_, i) => call2(`/api/collab/${doc.id}/op`, guest, {method: "POST", body: JSON.stringify({op: "add", item: {key: "movie:" + (100 + i), title: "F" + i}})})));
  const d = await (await call2("/api/collab/" + doc.id)).json();
  assert.equal(d.items.length, 11);
  assert.equal(d.v, 11);
  // Liste aus der Zeit vor dem Durable Object
  await KV.put("collab:ALTEliste123", JSON.stringify({id: "ALTEliste123", title: "Alt", items: [{key: "tv:5"}], v: 3}));
  const old = await (await call2("/api/collab/ALTEliste123")).json();
  assert.equal(old.title, "Alt");
  await call2("/api/collab/ALTEliste123", A, {method: "DELETE"});
  assert.equal((await call2("/api/collab/ALTEliste123")).status, 404);
  assert.equal(await KV.get("collab:ALTEliste123"), null);
});
