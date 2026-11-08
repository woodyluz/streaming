// Streamfinder-Proxy für Cloudflare Workers
// Hält den TMDB-Schlüssel geheim und speichert Antworten 1 Stunde im Edge-Cache.
//
// Variablen im Worker setzen (Settings → Variables):
//   TMDB_TOKEN      (Secret)  TMDB "API Read Access Token" (der lange Token, nicht der kurze Key)
//   ALLOWED_ORIGIN  (optional) z. B. https://deinname.github.io  – nur diese Seite darf den Proxy nutzen

export default {
  async fetch(req, env, ctx) {
    const allowed = env.ALLOWED_ORIGIN || "*";
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "GET") return new Response("Nur GET erlaubt", { status: 405, headers: cors });
    if (allowed !== "*" && origin && origin !== allowed) return new Response("Nicht erlaubt", { status: 403, headers: cors });

    const url = new URL(req.url);
    if (!url.pathname.startsWith("/3/")) return new Response("Nicht gefunden", { status: 404, headers: cors });
    url.searchParams.delete("api_key");
    const target = "https://api.themoviedb.org" + url.pathname + url.search;

    const cache = caches.default;
    const cacheKey = new Request(target);
    let res = await cache.match(cacheKey);
    if (!res) {
      res = await fetch(target, {
        headers: { Authorization: `Bearer ${env.TMDB_TOKEN}`, Accept: "application/json" },
      });
      if (res.ok) {
        res = new Response(res.body, res);
        res.headers.set("Cache-Control", "public, max-age=3600");
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
      }
    }

    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
