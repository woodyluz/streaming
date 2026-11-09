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
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
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

      if (p.startsWith("/api/")) return await handleApi(req, url, env, reply, hasSecret);
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
    ctx.waitUntil(runCheck(env));
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
async function handleApi(req, url, env, reply, hasSecret) {
  if (!env.SYNC_SECRET || !env.SF_KV) return reply("Sync ist nicht eingerichtet", 501);
  if (!hasSecret) return reply("Falsches Sync-Passwort", 401);
  const kv = env.SF_KV, p = url.pathname;

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
      alerts.push({ title: "Neue Folge heute", body: `${d.name}: Staffel ${e.season_number}, Folge ${e.episode_number}${e.name && !/^(Folge|Episode) \d+$/i.test(e.name) ? ` „${e.name}“` : ""}`, url: `./#t-tv-${s.id}` });
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

  await env.SF_KV.put("state", JSON.stringify(state));
  if (alerts.length) { await addInbox(env, alerts); await sendAll(env); }
}
