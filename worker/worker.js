// Streamfinder-Proxy für Cloudflare Workers
// Hält alle Schlüssel geheim, synchronisiert Listen zwischen Geräten und schickt Push-Mitteilungen.
//
// Einstellungen → Variablen und Secrets:
//   TMDB_TOKEN      (Secret)            TMDB "API Read Access Token" (der lange Token)
//   SA_KEY          (Secret, optional)  RapidAPI-Schlüssel für Streaming Availability
//   OMDB_KEY        (Secret, optional)  OMDb-Schlüssel für IMDb / Rotten Tomatoes / Metacritic
//   SYNC_SECRET     (Secret, optional)  Dein Sync-Passwort für Geräte-Sync und Push
//   ALLOWED_ORIGIN  (Text, optional)    z. B. https://deinname.github.io
//   CONTACT         (Text, optional)    deine E-Mail, wird Push-Diensten als Kontakt genannt
// Einstellungen → Bindungen: KV-Namespace mit dem Variablennamen SF_KV (für Sync und Push)
// Einstellungen → Trigger: Cron, z. B. "0 7 * * *" (täglich 08:00 Schweizer Winterzeit)

const SA_HOST = "streaming-availability.p.rapidapi.com";
const SA_MAP = { netflix: "netflix", netflixbasicwithads: "netflix", amazonprimevideo: "prime", amazonprimevideowithads: "prime",
  "disney+": "disney", "appletv+": "apple", appletv: "apple", max: "hbo", hbomax: "hbo", "paramount+": "paramount", mubi: "mubi", wow: "wow",
  crunchyroll: "crunchyroll", plutotv: "plutotv", britbox: "britbox", curiositystream: "curiosity", zee5: "zee5" };
const normName = s => String(s || "").toLowerCase().replace(/\bplus\b/g, "+").replace(/[^a-z0-9+]/g, "");

export default {
  async fetch(req, env, ctx) {
    const allowed = env.ALLOWED_ORIGIN || "*";
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const reply = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (allowed !== "*" && origin && origin !== allowed) return reply("Nicht erlaubt", 403);

    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, url, env, reply);
      if (req.method !== "GET") return reply("Nur GET erlaubt", 405);

      let target, headers, maxAge;
      if (url.pathname.startsWith("/3/")) {
        url.searchParams.delete("api_key");
        target = "https://api.themoviedb.org" + url.pathname + url.search;
        headers = { Authorization: `Bearer ${env.TMDB_TOKEN}`, Accept: "application/json" };
        maxAge = 3600;
      } else if (url.pathname.startsWith("/sa/")) {
        if (!env.SA_KEY) return reply("Streaming Availability ist nicht eingerichtet", 501);
        target = `https://${SA_HOST}` + url.pathname.slice(3) + url.search;
        headers = { "X-RapidAPI-Key": env.SA_KEY, "X-RapidAPI-Host": SA_HOST, Accept: "application/json" };
        maxAge = 43200;
      } else if (url.pathname === "/omdb") {
        if (!env.OMDB_KEY) return reply("OMDb ist nicht eingerichtet", 501);
        const i = url.searchParams.get("i") || "";
        if (!/^tt\d+$/.test(i)) return reply("Ungültige IMDb-ID", 400);
        target = `https://www.omdbapi.com/?i=${i}&apikey=${encodeURIComponent(env.OMDB_KEY)}`;
        headers = { Accept: "application/json" };
        maxAge = 604800;
      } else {
        return reply("Nicht gefunden", 404);
      }
      return await cached(target, headers, maxAge, cors, ctx);
    } catch (err) {
      return reply("Fehler im Worker: " + err.message, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  },
};

async function cached(target, headers, maxAge, cors, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(target);
  let res = await cache.match(cacheKey);
  if (!res) {
    res = await fetch(target, { headers });
    if (res.ok) {
      res = new Response(res.body, res);
      res.headers.set("Cache-Control", `public, max-age=${maxAge}`);
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

/* ---------- Sync & Push-API ---------- */
async function handleApi(req, url, env, reply) {
  if (!env.SYNC_SECRET || !env.SF_KV) return reply("Sync ist nicht eingerichtet", 501);
  const auth = req.headers.get("Authorization") || "";
  if (!safeEqual(auth, "Bearer " + env.SYNC_SECRET)) return reply("Falsches Sync-Passwort", 401);
  const kv = env.SF_KV, p = url.pathname;

  if (p === "/api/data" && req.method === "GET") return reply((await kv.get("data", "json")) || {});
  if (p === "/api/data" && req.method === "PUT") {
    const body = await req.json();
    if (!body || typeof body.updated !== "number" || typeof body.data !== "object") return reply("Ungültige Daten", 400);
    const text = JSON.stringify(body);
    if (text.length > 20_000_000) return reply("Zu gross", 413);
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
    const sent = await sendAll(env);
    return reply({ ok: true, sent });
  }
  if (p === "/api/inbox" && req.method === "GET") {
    const after = +url.searchParams.get("after") || 0;
    const inbox = (await kv.get("inbox", "json")) || [];
    return reply(inbox.filter(n => n.t > after));
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
  for (const it of items) inbox.push({ id: (t++).toString(36), t: t, ...it });
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
  const claims = b64uText(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.CONTACT ? "mailto:" + env.CONTACT : "mailto:streamfinder@example.com",
  }));
  const key = await crypto.subtle.importKey("jwk", v.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(header + "." + claims));
  const jwt = header + "." + claims + "." + b64u(sig);
  return fetch(endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "normal", Authorization: `vapid t=${jwt}, k=${v.pub}`, "Content-Length": "0" } });
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
      if (r.status === 404 || r.status === 410) continue; // Abo abgelaufen
      if (r.ok) sent++;
      keep.push(s);
    } catch (e) { keep.push(s); }
  }
  if (keep.length !== subs.length) await env.SF_KV.put("subs", JSON.stringify(keep));
  return sent;
}

/* ---------- Täglicher Check ---------- */
async function runCheck(env) {
  if (!env.SF_KV || !env.TMDB_TOKEN) return;
  const store = await env.SF_KV.get("data", "json");
  const data = store && store.data;
  if (!data) return;
  const country = data.country || "CH", mine = data.mine || [], names = data.mineNames || {};
  const items = new Map();
  for (const l of data.lists || []) for (const i of l.items || []) if (!items.has(i.key)) items.set(i.key, i);
  const all = [...items.values()];
  const state = (await env.SF_KV.get("state", "json")) || { cursor: 0, items: {}, exp: {} };
  const alerts = [];

  // Neue Verfügbarkeit: pro Lauf höchstens 35 Titel (Cloudflare-Grenze für Anfragen), reihum
  const batch = [];
  for (let n = 0; n < Math.min(35, all.length); n++) batch.push(all[(state.cursor + n) % all.length]);
  state.cursor = all.length ? (state.cursor + batch.length) % all.length : 0;
  for (const it of batch) {
    try {
      const r = await fetch(`https://api.themoviedb.org/3/${it.type}/${it.id}/watch/providers`, { headers: { Authorization: `Bearer ${env.TMDB_TOKEN}` } });
      if (!r.ok) continue;
      const reg = ((await r.json()).results || {})[country] || {};
      const flat = [...(reg.flatrate || []), ...(reg.free || []), ...(reg.ads || [])];
      const ids = flat.map(p => p.provider_id);
      const prev = state.items[it.key];
      if (prev && prev.c === country) {
        const added = flat.filter(p => !prev.f.includes(p.provider_id) && mine.includes(p.provider_id));
        if (added.length) alerts.push({ title: "Jetzt in deinen Diensten", body: `${it.title} ist neu bei ${[...new Set(added.map(p => p.provider_name))].join(", ")}`, url: `./#t-${it.type}-${it.id}` });
      }
      state.items[it.key] = { c: country, f: ids };
    } catch (e) {}
  }
  for (const k of Object.keys(state.items)) if (!items.has(k)) delete state.items[k];

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
          const date = new Date(c.timestamp * 1000).toLocaleDateString("de-CH", { day: "numeric", month: "long" });
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
