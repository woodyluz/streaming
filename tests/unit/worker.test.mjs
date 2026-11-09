// Worker mit nachgebautem Speicher und Netz testen
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../../worker/worker.js";

const kvStore = new Map();
const KV = {async get(k, t){ const v = kvStore.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v }, async put(k, v){ kvStore.set(k, v) }};
globalThis.caches = {default: {async match(){ return undefined }, async put(){}}};
let pushes = [], tmdbCalls = 0, flat = [], nextEp = null;
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  if (u.startsWith("https://push.example")){ pushes.push(o.headers.Authorization); return new Response(null, {status: 201}) }
  if (u.includes("/watch/providers")){ tmdbCalls++; return Response.json({results: {CH: {flatrate: flat}}}) }
  if (u.includes("/changes")) return Response.json({changes: [{showId: "s1", service: {id: "netflix", name: "Netflix"}, timestamp: Math.floor(Date.now() / 1000) + 3 * 86400}], shows: {s1: {tmdbId: "movie/550", title: "Fight Club"}}});
  if (u.match(/\/3\/tv\/\d+\?/)) return Response.json({name: "Die Serie", next_episode_to_air: nextEp});
  if (u.includes("api.themoviedb.org")) return Response.json({ok: true, auth: o.headers?.Authorization});
  if (u.includes("rapidapi")) return Response.json({sa: true});
  throw new Error("unerwartet " + u);
};
const env = {TMDB_TOKEN: "tok", SA_KEY: "sa", SYNC_SECRET: "geheim", SF_KV: KV, ALLOWED_ORIGIN: "https://me.github.io"};
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
