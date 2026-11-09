// Streamfinder-Worker für Cloudflare
// Liefert die Seite aus (Ordner public/), ist Proxy für TMDB, Streaming Availability und OMDb,
// synchronisiert Daten zwischen Geräten und verschickt Push-Mitteilungen.
//
// Zugriffsschutz:
//   /3/ und /batch/   nur für Anfragen deiner eigenen Seite (gleiche Adresse oder ALLOWED_ORIGIN) oder mit Sync-Passwort
//   /sa/ und /omdb    nur mit Sync-Passwort (wenn SYNC_SECRET gesetzt ist), weil die Kontingente knapp sind
//   /api/             immer nur mit Sync-Passwort
//
// Einstellungen → Variablen und Secrets:
//   TMDB_TOKEN      (Secret)            TMDB "API Read Access Token" (der lange Token)
//   SYNC_SECRET     (Secret)            Dein Sync-Passwort
//   SA_KEY          (Secret, optional)  RapidAPI-Schlüssel für Streaming Availability
//   OMDB_KEY        (Secret, optional)  OMDb-Schlüssel
//   ALLOWED_ORIGIN  (Text, optional)    weitere erlaubte Adressen, durch Komma getrennt, z. B. https://deinname.github.io
//   CONTACT         (Text, optional)    deine E-Mail, wird Push-Diensten als Kontakt genannt
//   ANTHROPIC_API_KEY (Secret, optional) für die Stimmungssuche mit KI (sonst Stichwort-Suche im Browser)
//   TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET (Secrets, optional) für den Abgleich mit Trakt
// Speicher (SF_KV) und täglicher Zeitplan stehen in wrangler.jsonc.

const SA_HOST = "streaming-availability.p.rapidapi.com";
const SA_MAP = { netflix: "netflix", netflixbasicwithads: "netflix", netflixstandardwithads: "netflix", amazonprimevideo: "prime", amazonprimevideowithads: "prime",
  "disney+": "disney", "appletv+": "apple", appletv: "apple", max: "hbo", hbomax: "hbo", "paramount+": "paramount", mubi: "mubi", wow: "wow",
  crunchyroll: "crunchyroll", plutotv: "plutotv", britbox: "britbox", curiositystream: "curiosity", zee5: "zee5" };
const normName = s => String(s || "").toLowerCase().replace(/\bplus\b/g, "+").replace(/[^a-z0-9+]/g, "");
const BATCH_MAX = 15;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const allowed = [url.origin, ...String(env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(s => s && s !== "*")];
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    if (origin && allowed.includes(origin)) cors["Access-Control-Allow-Origin"] = origin;
    const reply = (body, status = 200, extra = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", ...extra } });

    if (req.method === "OPTIONS") return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });

    const p = url.pathname;
    try {
      const hasSecret = !!env.SYNC_SECRET && safeEqual(req.headers.get("Authorization") || "", "Bearer " + env.SYNC_SECRET);
      const ownPage = fromOwnPage(req, allowed);

      if (p.startsWith("/api/")) return await handleApi(req, url, env, reply, hasSecret, ownPage);
      if (req.method !== "GET") return reply("Nur GET erlaubt", 405);

      if (p.startsWith("/3/") || p === "/batch/providers") {
        if (!ownPage && !hasSecret) return reply("Nur für die eigene Seite", 403);
        if (!env.TMDB_TOKEN) return reply("TMDB_TOKEN fehlt im Worker", 501);
        if (p === "/batch/providers") return await batchProviders(url, env, ctx, reply);
        url.searchParams.delete("api_key");
        return await cached("https://api.themoviedb.org" + p + url.search, tmdbHeaders(env), 3600, cors, ctx);
      }
      if (p.startsWith("/sa/") || p === "/omdb") {
        if (env.SYNC_SECRET ? !hasSecret : !ownPage) return reply("Nur für verbundene Geräte", 401);
        if (p === "/omdb") {
          if (!env.OMDB_KEY) return reply("OMDb ist nicht eingerichtet", 501);
          const i = url.searchParams.get("i") || "";
          if (!/^tt\d+$/.test(i)) return reply("Ungültige IMDb-ID", 400);
          return await cached(`https://www.omdbapi.com/?i=${i}&apikey=${encodeURIComponent(env.OMDB_KEY)}`, { Accept: "application/json" }, 604800, cors, ctx);
        }
        if (!env.SA_KEY) return reply("Streaming Availability ist nicht eingerichtet", 501);
        if (!/^\/sa\/(shows|changes)\b/.test(p)) return reply("Nicht gefunden", 404);
        return await cached(`https://${SA_HOST}` + p.slice(3) + url.search, { "X-RapidAPI-Key": env.SA_KEY, "X-RapidAPI-Host": SA_HOST, Accept: "application/json" }, 43200, cors, ctx);
      }
      return reply("Nicht gefunden", 404);
    } catch (err) {
      return reply("Fehler im Worker: " + err.message, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([runCheck(env), weeklyBackup(env)]));
  },
};

// Kommt die Anfrage von der eigenen Seite? Browser schicken Origin bzw. Referer mit, fremde Seiten können das nicht fälschen.
function fromOwnPage(req, allowed) {
  const site = req.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" && !allowed.includes(req.headers.get("Origin") || "")) return false;
  let o = req.headers.get("Origin");
  if (!o) { try { o = new URL(req.headers.get("Referer") || "").origin } catch (e) { o = "" } }
  return !!o && allowed.includes(o);
}
const tmdbHeaders = env => ({ Authorization: `Bearer ${env.TMDB_TOKEN}`, Accept: "application/json" });

async function cached(target, headers, maxAge, cors, ctx) {
  const cache = caches.default;
  const key = new Request(target);
  let res = await cache.match(key);
  if (!res) {
    res = await fetch(target, { headers });
    if (res.ok) {
      res = new Response(res.body, res);
      res.headers.set("Cache-Control", `public, max-age=${maxAge}`);
      ctx.waitUntil(cache.put(key, res.clone()));
    }
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

// Verfügbarkeit vieler Titel in einer Anfrage: ?region=CH&ids=movie:1,tv:2
async function batchProviders(url, env, ctx, reply) {
  const region = (url.searchParams.get("region") || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) return reply("Ungültige Region", 400);
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").filter(x => /^(movie|tv):\d+$/.test(x)))].slice(0, BATCH_MAX);
  const out = {};
  await Promise.all(ids.map(async k => {
    const [type, id] = k.split(":");
    try {
      const target = `https://api.themoviedb.org/3/${type}/${id}/watch/providers`;
      const key = new Request(target);
      let res = await caches.default.match(key);
      if (!res) {
        res = await fetch(target, { headers: tmdbHeaders(env) });
        if (res.ok) {
          res = new Response(res.body, res);
          res.headers.set("Cache-Control", "public, max-age=3600");
          ctx.waitUntil(caches.default.put(key, res.clone()));
        }
      }
      if (res.ok) out[k] = ((await res.json()).results || {})[region] || null;
    } catch (e) {}
  }));
  return reply(out, 200, { "Cache-Control": "private, max-age=600" });
}

/* ---------- Sync & Push ---------- */
async function handleApi(req, url, env, reply, hasSecret, ownPage) {
  if (!env.SF_KV) return reply("Speicher SF_KV fehlt", 501);
  const kv = env.SF_KV, p = url.pathname;
  let m;

  // Öffentlich (für Freunde ohne Passwort), aber nur über die eigene Seite
  if ((m = p.match(/^\/api\/vote\/([A-Za-z0-9]{10})$/)) && req.method === "GET") {
    const doc = await kv.get("vote:" + m[1], "json");
    if (!doc) return reply("Abstimmung nicht gefunden oder abgelaufen", 404);
    const keys = (await kv.list({ prefix: `vp:${m[1]}:` })).keys;
    const parts = (await Promise.all(keys.map(k => kv.get(k.name, "json")))).filter(Boolean);
    return reply({ ...doc, parts }, 200, { "Cache-Control": "no-store" });
  }
  if ((m = p.match(/^\/api\/vote\/([A-Za-z0-9]{10})\/p\/([A-Za-z0-9]{6,16})$/)) && req.method === "PUT") {
    if (!ownPage && !hasSecret) return reply("Nur über die eigene Seite", 403);
    const doc = await kv.get("vote:" + m[1], "json");
    if (!doc) return reply("Abstimmung nicht gefunden oder abgelaufen", 404);
    if (doc.closed) return reply("Abstimmung ist beendet", 409);
    const b = await req.json().catch(() => null);
    const valid = new Set(doc.items.map(i => i.key));
    const clean = a => [...new Set((Array.isArray(a) ? a : []).filter(k => valid.has(k)))];
    const part = { pid: m[2], name: String(b?.name || "Gast").trim().slice(0, 30) || "Gast", yes: clean(b?.yes), no: clean(b?.no), done: !!b?.done, t: Date.now() };
    part.no = part.no.filter(k => !part.yes.includes(k));
    await kv.put(`vp:${m[1]}:${m[2]}`, JSON.stringify(part), { expirationTtl: VOTE_TTL });
    return reply({ ok: true });
  }
  if ((m = p.match(/^\/api\/share\/([A-Za-z0-9]{10})$/)) && req.method === "GET") {
    const doc = await kv.get("share:" + m[1], "json");
    return doc ? reply(doc, 200, { "Cache-Control": "no-store" }) : reply("Liste nicht gefunden", 404);
  }
  // Gemeinsame Listen: lesen und bearbeiten für alle mit Link, anonym
  if ((m = p.match(/^\/api\/collab\/([A-Za-z0-9]{12})$/)) && req.method === "GET") {
    const doc = await kv.get("collab:" + m[1], "json");
    return doc ? reply(doc, 200, { "Cache-Control": "no-store" }) : reply("Liste nicht gefunden", 404);
  }
  if ((m = p.match(/^\/api\/collab\/([A-Za-z0-9]{12})\/op$/)) && req.method === "POST") {
    if (!ownPage && !hasSecret) return reply("Nur über die eigene Seite", 403);
    const doc = await kv.get("collab:" + m[1], "json");
    if (!doc) return reply("Liste nicht gefunden", 404);
    const b = await req.json().catch(() => null);
    if (b?.op === "add") {
      const it = cleanItem(b.item);
      if (!it) return reply("Ungültiger Titel", 400);
      if (doc.items.length >= 500) return reply("Die Liste ist voll (500 Titel)", 409);
      if (!doc.items.some(i => i.key === it.key)) doc.items.unshift({ ...it, added: Date.now() });
    } else if (b?.op === "remove" && typeof b.key === "string") {
      doc.items = doc.items.filter(i => i.key !== b.key);
    } else return reply("Unbekannte Änderung", 400);
    doc.updated = Date.now(); doc.v = (doc.v || 0) + 1;
    await kv.put("collab:" + m[1], JSON.stringify(doc));
    return reply(doc);
  }
  if (p === "/api/mood" && req.method === "POST") {
    if (!ownPage && !hasSecret) return reply("Nur über die eigene Seite", 403);
    if (!env.ANTHROPIC_API_KEY) return reply("KI ist nicht eingerichtet", 501);
    return await mood(req, env, reply);
  }

  if (!env.SYNC_SECRET) return reply("Sync ist nicht eingerichtet", 501);
  if (!hasSecret) return reply("Falsches Sync-Passwort", 401);

  if (p === "/api/data" && req.method === "GET") return reply((await kv.get("data", "json")) || {});
  if (p === "/api/data" && req.method === "PUT") {
    const text = await req.text();
    if (text.length > 20_000_000) return reply("Zu gross", 413);
    let body; try { body = JSON.parse(text) } catch (e) { return reply("Ungültige Daten", 400) }
    if (!body || typeof body.updated !== "number" || typeof body.data !== "object") return reply("Ungültige Daten", 400);
    await kv.put("data", text);
    return reply({ ok: true });
  }
  if (p === "/api/push/key" && req.method === "GET") return reply({ key: (await vapidKeys(env)).pub });
  if (p === "/api/push/subscribe" && req.method === "POST") {
    const sub = await req.json();
    if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")) return reply("Ungültiges Abo", 400);
    const subs = ((await kv.get("subs", "json")) || []).filter(s => s.endpoint !== sub.endpoint);
    subs.push({ endpoint: sub.endpoint, added: Date.now() });
    await kv.put("subs", JSON.stringify(subs.slice(-10)));
    return reply({ ok: true });
  }
  if (p === "/api/push/test" && req.method === "POST") {
    await addInbox(env, [{ title: "Streamfinder", body: "Test erfolgreich. So sehen deine Mitteilungen aus.", url: "./#listen" }]);
    return reply({ ok: true, sent: await sendAll(env) });
  }
  if (p === "/api/inbox" && req.method === "GET") {
    const after = +url.searchParams.get("after") || 0;
    return reply(((await kv.get("inbox", "json")) || []).filter(n => n.t > after));
  }

  // Filmabend
  if (p === "/api/vote" && req.method === "POST") {
    const b = await req.json().catch(() => null);
    const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 30).filter(i => i && /^(movie|tv):\d+$/.test(i.key)).map(i => ({
      key: i.key, type: i.key.split(":")[0], id: +i.key.split(":")[1], title: String(i.title || "").slice(0, 120), poster: typeof i.poster === "string" ? i.poster.slice(0, 80) : null,
      year: String(i.year || "").slice(0, 4), info: String(i.info || "").slice(0, 80), overview: String(i.overview || "").slice(0, 400) }));
    if (items.length < 2) return reply("Mindestens zwei Titel nötig", 400);
    const id = randomId(10);
    await kv.put("vote:" + id, JSON.stringify({ id, title: String(b?.title || "Filmabend").slice(0, 60), host: String(b?.host || "").slice(0, 30), created: Date.now(), items, closed: false }), { expirationTtl: VOTE_TTL });
    return reply({ id });
  }
  if ((m = p.match(/^\/api\/vote\/([A-Za-z0-9]{10})\/close$/)) && req.method === "POST") {
    const doc = await kv.get("vote:" + m[1], "json");
    if (!doc) return reply("Nicht gefunden", 404);
    doc.closed = true;
    await kv.put("vote:" + m[1], JSON.stringify(doc), { expirationTtl: VOTE_TTL });
    return reply({ ok: true });
  }

  // Geteilte Listen
  if (p === "/api/share" && req.method === "POST") {
    const b = await req.json().catch(() => null);
    const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 500).filter(i => i && /^(movie|tv):\d+$/.test(i.key)).map(i => ({
      key: i.key, type: i.key.split(":")[0], id: +i.key.split(":")[1], title: String(i.title || "").slice(0, 120), poster: typeof i.poster === "string" ? i.poster.slice(0, 80) : null,
      year: String(i.year || "").slice(0, 4), note: String(i.note || "").slice(0, 280), stars: [1, 2, 3, 4, 5].includes(i.stars) ? i.stars : 0 }));
    const id = b?.id && /^[A-Za-z0-9]{10}$/.test(b.id) ? b.id : randomId(10);
    const doc = { id, title: String(b?.title || "Liste").slice(0, 60), by: String(b?.by || "").slice(0, 30), intro: String(b?.intro || "").slice(0, 400), items, updated: Date.now() };
    await kv.put("share:" + id, JSON.stringify(doc));
    return reply({ id });
  }
  if ((m = p.match(/^\/api\/share\/([A-Za-z0-9]{10})$/)) && req.method === "DELETE") {
    await kv.delete("share:" + m[1]);
    return reply({ ok: true });
  }

  // Gemeinsame Listen anlegen, ersetzen, beenden (nur Besitzer)
  if (p === "/api/collab" && req.method === "POST") {
    const b = await req.json().catch(() => null);
    const id = b?.id && /^[A-Za-z0-9]{12}$/.test(b.id) ? b.id : randomId(12);
    const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 500).map(cleanItem).filter(Boolean).map(i => ({ ...i, added: Date.now() }));
    const doc = { id, title: String(b?.title || "Gemeinsame Liste").slice(0, 60), items, updated: Date.now(), v: 1 };
    await kv.put("collab:" + id, JSON.stringify(doc));
    return reply(doc);
  }
  if ((m = p.match(/^\/api\/collab\/([A-Za-z0-9]{12})$/)) && req.method === "DELETE") {
    await kv.delete("collab:" + m[1]);
    return reply({ ok: true });
  }

  // Sicherungen
  if (p === "/api/backups" && req.method === "GET") {
    const keys = (await kv.list({ prefix: "backup:" })).keys.map(k => k.name.slice(7)).sort().reverse();
    return reply(keys);
  }
  if (p === "/api/backups" && req.method === "POST") return reply({ id: await makeBackup(env, true) });
  if ((m = p.match(/^\/api\/backups\/([0-9T:-]{10,19})$/)) && req.method === "GET") {
    const d = await kv.get("backup:" + m[1], "json");
    return d ? reply(d) : reply("Sicherung nicht gefunden", 404);
  }

  // Trakt
  if (p.startsWith("/api/trakt")) return await trakt(req, p, env, reply);

  return reply("Nicht gefunden", 404);
}

const VOTE_TTL = 7 * 86400;
function cleanItem(i) {
  if (!i || !/^(movie|tv):\d{1,9}$/.test(i.key)) return null;
  return { key: i.key, type: i.key.split(":")[0], id: +i.key.split(":")[1], title: String(i.title || "").slice(0, 120),
    poster: typeof i.poster === "string" && /^\/[\w.-]{1,80}$/.test(i.poster) ? i.poster : null, year: String(i.year || "").replace(/\D/g, "").slice(0, 4) };
}
function randomId(n) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map(x => a[x % a.length]).join("");
}

/* ---------- Sicherungen ---------- */
async function makeBackup(env, manual) {
  const d = await env.SF_KV.get("data");
  if (!d) return null;
  const id = new Date().toISOString().slice(0, manual ? 19 : 10);
  await env.SF_KV.put("backup:" + id, d);
  const keys = (await env.SF_KV.list({ prefix: "backup:" })).keys.map(k => k.name).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 10))) await env.SF_KV.delete(k);
  return id;
}
async function weeklyBackup(env) {
  if (!env.SF_KV) return;
  const keys = (await env.SF_KV.list({ prefix: "backup:" })).keys.map(k => k.name.slice(7)).sort();
  const last = keys.length ? Date.parse(keys[keys.length - 1].slice(0, 10)) : 0;
  if (Date.now() - last >= 6.5 * 864e5) await makeBackup(env, false);
}

/* ---------- Stimmungssuche mit KI ---------- */
const MOOD_PROMPT = `Du übersetzt Filmwünsche in Suchfilter für TMDB. Antworte nur mit JSON in genau dieser Form:
{"type":"movie"|"tv"|null,"genres":{"movie":[ids],"tv":[ids]},"without":{"movie":[ids],"tv":[ids]},"runtimeMax":number|null,"runtimeMin":number|null,"yearMin":number|null,"yearMax":number|null,"voteMin":number|null,"voteCountMax":number|null,"fskMax":0|6|12|16|null,"lang":"ISO-639-1, mehrere mit |"|null,"country":"ISO-3166-1"|null,"understood":["kurze deutsche Stichworte, was du verstanden hast"],"notes":["optional ein kurzer Hinweis auf Deutsch"]}
Film-Genres: 28 Action, 12 Abenteuer, 16 Animation, 35 Komödie, 80 Krimi, 99 Doku, 18 Drama, 10751 Familie, 14 Fantasy, 36 Historie, 27 Horror, 10402 Musik, 9648 Mystery, 10749 Liebesfilm, 878 Science-Fiction, 53 Thriller, 10752 Kriegsfilm, 37 Western.
Serien-Genres: 10759 Action & Abenteuer, 16 Animation, 35 Komödie, 80 Krimi, 99 Doku, 18 Drama, 10751 Familie, 10762 Kinder, 9648 Mystery, 10765 Sci-Fi & Fantasy, 10768 Krieg & Politik, 37 Western.
Mehrere Genres bedeuten „eines davon“. Setze nur, was der Wunsch hergibt. „Nicht zu brutal“ heisst fskMax 12. Laufzeit in Minuten (bei Serien pro Folge).`;
async function mood(req, env, reply) {
  const b = await req.json().catch(() => null);
  const text = String(b?.text || "").trim().slice(0, 400);
  if (!text) return reply("Leerer Wunsch", 400);
  const day = new Date().toISOString().slice(0, 10);
  const n = +(await env.SF_KV.get("moodcount:" + day)) || 0;
  if (n >= 300) return reply("Tageslimit erreicht", 429);
  await env.SF_KV.put("moodcount:" + day, String(n + 1), { expirationTtl: 2 * 86400 });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 500, system: MOOD_PROMPT, messages: [{ role: "user", content: text }] })
  });
  if (!r.ok) return reply("KI-Fehler " + r.status, 502);
  const d = await r.json();
  const out = (d.content || []).map(c => c.text || "").join("");
  const j = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  try { return reply({ filters: JSON.parse(j) }) } catch (e) { return reply("KI-Antwort unlesbar", 502) }
}

/* ---------- Trakt ---------- */
const TRAKT = "https://api.trakt.tv";
const traktHeaders = (env, token) => ({ "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": env.TRAKT_CLIENT_ID, ...(token ? { Authorization: "Bearer " + token } : {}) });
async function traktToken(env) {
  const t = await env.SF_KV.get("trakt", "json");
  if (!t) return null;
  if (Date.now() < (t.created_at + t.expires_in) * 1000 - 864e5) return t.access_token;
  const r = await fetch(TRAKT + "/oauth/token", { method: "POST", headers: traktHeaders(env),
    body: JSON.stringify({ refresh_token: t.refresh_token, client_id: env.TRAKT_CLIENT_ID, client_secret: env.TRAKT_CLIENT_SECRET, redirect_uri: "urn:ietf:wg:oauth:2.0:oob", grant_type: "refresh_token" }) });
  if (!r.ok) return null;
  const n = await r.json();
  await env.SF_KV.put("trakt", JSON.stringify(n));
  return n.access_token;
}
async function trakt(req, p, env, reply) {
  if (!env.TRAKT_CLIENT_ID || !env.TRAKT_CLIENT_SECRET) return reply("Trakt ist nicht eingerichtet", 501);
  const kv = env.SF_KV;
  if (p === "/api/trakt/status") return reply({ connected: !!(await kv.get("trakt")) });
  if (p === "/api/trakt" && req.method === "DELETE") { await kv.delete("trakt"); return reply({ ok: true }) }
  if (p === "/api/trakt/code" && req.method === "POST") {
    const r = await fetch(TRAKT + "/oauth/device/code", { method: "POST", headers: traktHeaders(env), body: JSON.stringify({ client_id: env.TRAKT_CLIENT_ID }) });
    if (!r.ok) return reply("Trakt antwortet mit " + r.status, 502);
    const d = await r.json();
    await kv.put("traktcode", d.device_code, { expirationTtl: Math.max(60, d.expires_in || 600) });
    return reply({ user_code: d.user_code, verification_url: d.verification_url, interval: d.interval || 5, expires_in: d.expires_in });
  }
  if (p === "/api/trakt/poll" && req.method === "POST") {
    const code = await kv.get("traktcode");
    if (!code) return reply({ state: "expired" });
    const r = await fetch(TRAKT + "/oauth/device/token", { method: "POST", headers: traktHeaders(env),
      body: JSON.stringify({ code, client_id: env.TRAKT_CLIENT_ID, client_secret: env.TRAKT_CLIENT_SECRET }) });
    if (r.status === 200) { await kv.put("trakt", JSON.stringify(await r.json())); await kv.delete("traktcode"); return reply({ state: "ok" }) }
    if (r.status === 400) return reply({ state: "pending" });
    if (r.status === 429) return reply({ state: "slow" });
    return reply({ state: r.status === 418 ? "denied" : "expired" });
  }
  if (p === "/api/trakt/watched" && req.method === "GET") {
    const token = await traktToken(env);
    if (!token) return reply("Nicht mit Trakt verbunden", 401);
    const [m, s] = await Promise.all([
      fetch(TRAKT + "/sync/watched/movies", { headers: traktHeaders(env, token) }).then(r => r.ok ? r.json() : []),
      fetch(TRAKT + "/sync/watched/shows", { headers: traktHeaders(env, token) }).then(r => r.ok ? r.json() : [])]);
    const movies = m.filter(x => x.movie?.ids?.tmdb).map(x => ({ tmdb: x.movie.ids.tmdb, title: x.movie.title, year: x.movie.year, at: x.last_watched_at }));
    const shows = s.filter(x => x.show?.ids?.tmdb).map(x => {
      let last = null;
      for (const se of x.seasons || []) { if (se.number < 1) continue; for (const e of se.episodes || []) if (!last || se.number > last.s || (se.number === last.s && e.number > last.e)) last = { s: se.number, e: e.number } }
      return { tmdb: x.show.ids.tmdb, title: x.show.title, year: x.show.year, at: x.last_watched_at, last };
    });
    return reply({ movies, shows });
  }
  return reply("Nicht gefunden", 404);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function addInbox(env, items) {
  const inbox = (await env.SF_KV.get("inbox", "json")) || [];
  let t = Date.now();
  for (const it of items) { t++; inbox.push({ id: t.toString(36), t, ...it }) }
  await env.SF_KV.put("inbox", JSON.stringify(inbox.slice(-60)));
}

/* ---------- Web Push mit VAPID, ohne Nutzlast ---------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uText = s => b64u(new TextEncoder().encode(s));
async function vapidKeys(env) {
  let v = await env.SF_KV.get("vapid", "json");
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { priv: await crypto.subtle.exportKey("jwk", kp.privateKey), pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)) };
    await env.SF_KV.put("vapid", JSON.stringify(v));
  }
  return v;
}
async function sendPush(endpoint, env, v) {
  const header = b64uText(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64uText(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.CONTACT ? "mailto:" + env.CONTACT : "mailto:streamfinder@example.com" }));
  const key = await crypto.subtle.importKey("jwk", v.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(header + "." + claims));
  return fetch(endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "normal", Authorization: `vapid t=${header}.${claims}.${b64u(sig)}, k=${v.pub}`, "Content-Length": "0" } });
}
async function sendAll(env) {
  const subs = (await env.SF_KV.get("subs", "json")) || [];
  if (!subs.length) return 0;
  const v = await vapidKeys(env);
  const keep = [];
  let sent = 0;
  for (const s of subs) {
    try {
      const r = await sendPush(s.endpoint, env, v);
      if (r.status === 404 || r.status === 410) continue;
      if (r.ok) sent++;
      keep.push(s);
    } catch (e) { keep.push(s) }
  }
  if (keep.length !== subs.length) await env.SF_KV.put("subs", JSON.stringify(keep));
  return sent;
}

/* ---------- Täglicher Check ---------- */
// Profile (Version 4) und einzelne Liste (Version 3) lesen
function collect(data) {
  const profiles = data.pdata ? Object.values(data.pdata) : [{ lists: data.lists || [], follow: {}, progress: data.progress || {} }];
  const items = new Map(), follows = new Map();
  for (const pd of profiles) {
    for (const l of pd.lists || []) for (const i of l.items || []) if (i && i.key && !items.has(i.key)) items.set(i.key, i);
    for (const [k, v] of Object.entries(pd.follow || {})) if (!follows.has(k)) follows.set(k, { ...v, key: k, id: +k.split(":")[1] });
    for (const k of Object.keys(pd.progress || {})) if (k.startsWith("tv:") && !follows.has(k)) follows.set(k, { key: k, id: +k.split(":")[1], title: (items.get(k) || {}).title });
  }
  return { items, follows };
}
const zurichDate = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

async function runCheck(env) {
  if (!env.SF_KV || !env.TMDB_TOKEN) return;
  const store = await env.SF_KV.get("data", "json");
  const data = store && store.data;
  if (!data) return;
  const country = data.country || "CH", mine = data.mine || [], names = data.mineNames || {};
  const { items, follows } = collect(data);
  const all = [...items.values()], fl = [...follows.values()];
  const state = (await env.SF_KV.get("state", "json")) || {};
  state.cursor ||= 0; state.fcursor ||= 0; state.items ||= {}; state.exp ||= {}; state.ep ||= {};
  const alerts = [];
  // Budget: Cloudflare erlaubt 50 Anfragen pro Lauf (Listen 25, Serien 10, Streaming Availability 1, Rest für Push)

  // Neu in deinen Diensten
  const batch = [];
  for (let n = 0; n < Math.min(25, all.length); n++) batch.push(all[(state.cursor + n) % all.length]);
  state.cursor = all.length ? (state.cursor + batch.length) % all.length : 0;
  for (const it of batch) {
    try {
      const r = await fetch(`https://api.themoviedb.org/3/${it.type}/${it.id}/watch/providers`, { headers: tmdbHeaders(env) });
      if (!r.ok) continue;
      const reg = ((await r.json()).results || {})[country] || {};
      const flat = [...(reg.flatrate || []), ...(reg.free || []), ...(reg.ads || [])];
      const prev = state.items[it.key];
      if (prev && prev.c === country) {
        const added = flat.filter(p => !prev.f.includes(p.provider_id) && mine.includes(p.provider_id));
        if (added.length) alerts.push({ title: "Jetzt in deinen Diensten", body: `${it.title} ist neu bei ${[...new Set(added.map(p => p.provider_name))].join(", ")}`, url: `./#t-${it.type}-${it.id}` });
      }
      state.items[it.key] = { c: country, f: flat.map(p => p.provider_id) };
    } catch (e) {}
  }
  for (const k of Object.keys(state.items)) if (!items.has(k)) delete state.items[k];

  // Neue Folge heute
  const today = zurichDate();
  const fbatch = [];
  for (let n = 0; n < Math.min(10, fl.length); n++) fbatch.push(fl[(state.fcursor + n) % fl.length]);
  state.fcursor = fl.length ? (state.fcursor + fbatch.length) % fl.length : 0;
  for (const s of fbatch) {
    try {
      const r = await fetch(`https://api.themoviedb.org/3/tv/${s.id}?language=de-DE`, { headers: tmdbHeaders(env) });
      if (!r.ok) continue;
      const d = await r.json(), e = d.next_episode_to_air || d.last_episode_to_air;
      if (!e || e.air_date !== today) continue;
      const mark = `${s.id}:${e.season_number}:${e.episode_number}`;
      if (state.ep[mark]) continue;
      state.ep[mark] = Date.now();
      const spoiler = (data.profiles || []).some(p => p.spoiler);
      alerts.push({ title: "Neue Folge heute", body: `${d.name}: Staffel ${e.season_number}, Folge ${e.episode_number}${!spoiler && e.name && !/^(Folge|Episode) \d+$/i.test(e.name) ? ` „${e.name}“` : ""}`, url: `./#t-tv-${s.id}` });
    } catch (e) {}
  }
  for (const [k, t] of Object.entries(state.ep)) if (t < Date.now() - 30 * 864e5) delete state.ep[k];

  // Letzte Chance: Titel auf deinen Listen, die in den nächsten 10 Tagen einen deiner Dienste verlassen
  const cats = [...new Set(mine.map(id => SA_MAP[normName(names[id])]).filter(Boolean))];
  if (env.SA_KEY && cats.length && all.length) {
    try {
      const q = new URLSearchParams({ change_type: "expiring", item_type: "show", country: country.toLowerCase(), catalogs: cats.join(","), order_direction: "asc", include_unknown_dates: "false" });
      const r = await fetch(`https://${SA_HOST}/changes?${q}`, { headers: { "X-RapidAPI-Key": env.SA_KEY, "X-RapidAPI-Host": SA_HOST } });
      if (r.ok) {
        const d = await r.json(), soon = Date.now() / 1000 + 10 * 86400;
        for (const c of d.changes || []) {
          const sh = (d.shows || {})[c.showId]; if (!sh || !sh.tmdbId) continue;
          const [t, i] = sh.tmdbId.split("/"), key = (t === "tv" ? "tv" : "movie") + ":" + i;
          const it = items.get(key), mark = key + ":" + (c.service?.id || "");
          if (!it || state.exp[mark] || !c.timestamp || c.timestamp > soon) continue;
          state.exp[mark] = c.timestamp;
          const date = new Date(c.timestamp * 1000).toLocaleDateString("de-CH", { day: "numeric", month: "long", timeZone: "Europe/Zurich" });
          alerts.push({ title: "Letzte Chance", body: `${it.title} verlässt ${c.service?.name || "deinen Dienst"} am ${date}`, url: `./#t-${it.type}-${it.id}` });
        }
        const now = Date.now() / 1000;
        for (const [k, ts] of Object.entries(state.exp)) if (ts < now - 86400) delete state.exp[k];
      }
    } catch (e) {}
  }

  // Preiswächter: beobachtete Titel reihum über Streaming Availability prüfen
  const watch = [];
  for (const pd of Object.values(data.pdata || {})) for (const [k, v] of Object.entries(pd.pwatch || {})) if (!watch.some(w => w.key === k)) watch.push({ ...v, key: k });
  state.pcursor ||= 0; state.prices ||= {};
  if (env.SA_KEY && watch.length) {
    const n = Math.min(6, watch.length);
    for (let i = 0; i < n; i++) {
      const w = watch[(state.pcursor + i) % watch.length];
      try {
        const [type, id] = w.key.split(":");
        const r = await fetch(`https://${SA_HOST}/shows/${type}/${id}?country=${country.toLowerCase()}`, { headers: { "X-RapidAPI-Key": env.SA_KEY, "X-RapidAPI-Host": SA_HOST } });
        if (!r.ok) continue;
        const now = cheapest(await r.json(), country, names, mine);
        const prev = state.prices[w.key];
        const title = w.title || "Ein Titel";
        if (prev) {
          if (now.mine && !prev.mine) alerts.push({ title: "Jetzt im Abo", body: `${title} läuft jetzt bei ${now.mine}`, url: `./#t-${type}-${id}` });
          else for (const kind of ["rent", "buy"]) if (now[kind] && prev[kind] && now[kind].amount <= prev[kind].amount - 0.5)
            alerts.push({ title: "Günstiger", body: `${title} zum ${kind === "rent" ? "Leihen" : "Kaufen"} jetzt ${now[kind].text} statt ${prev[kind].text}`, url: `./#t-${type}-${id}` });
        }
        state.prices[w.key] = now;
      } catch (e) {}
    }
    state.pcursor = (state.pcursor + n) % watch.length;
    for (const k of Object.keys(state.prices)) if (!watch.some(w => w.key === k)) delete state.prices[k];
  }

  await env.SF_KV.put("state", JSON.stringify(state));
  if (alerts.length) { await addInbox(env, alerts); await sendAll(env); }
}

function cheapest(show, country, names, mine) {
  const opts = (show.streamingOptions || {})[country.toLowerCase()] || [];
  const out = { rent: null, buy: null, mine: null };
  const mineNames = mine.map(id => normName(names[id]));
  for (const o of opts) {
    if (o.type === "subscription" && mineNames.includes(normName(o.service?.name))) out.mine = o.service.name;
    if ((o.type === "rent" || o.type === "buy") && o.price) {
      const a = +o.price.amount;
      if (!out[o.type] || a < out[o.type].amount) out[o.type] = { amount: a, text: o.price.formatted || String(a), service: o.service?.name || "" };
    }
  }
  return out;
}
