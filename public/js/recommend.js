// Empfehlungen: Punkte vergeben und Begründungen formulieren. Reine Funktionen, getestet in tests/unit/recommend.test.mjs.

const num = v => (+v).toFixed(1).replace(".", ",");

// seedRecs: [{seed, recs}]  seed.how: "liked" | "seen" | "list"
// disliked: [{key, recs, genres:[ids]}]
export function scoreCandidates({seedRecs, disliked = [], exclude = new Set(), likedGenres = new Map()}){
  const cand = new Map();
  for (const {seed, recs} of seedRecs){
    (recs || []).forEach((r, i) => {
      const key = r.media_type + ":" + r.id;
      if (exclude.has(key)) return;
      const c = cand.get(key) || {r, key, seeds: [], score: 0, penalty: 0};
      c.seeds.push(seed);
      c.score += 2 + (14 - Math.min(i, 14)) / 14 * 3 + (seed.how === "liked" || seed.how === "picked" ? 1.5 : 0);
      cand.set(key, c);
    });
  }
  // Abwertung: von nicht gemochten Titeln empfohlen, oder deren Genres
  const badRec = new Map(), badGenre = new Map();
  for (const d of disliked){
    (d.recs || []).forEach((r, i) => badRec.set(r.media_type + ":" + r.id, (badRec.get(r.media_type + ":" + r.id) || 0) + 3 + (14 - Math.min(i, 14)) / 14 * 2));
    for (const g of d.genres || []) badGenre.set(g, (badGenre.get(g) || 0) + 1);
  }
  const nBad = disliked.length || 1, likedTotal = [...likedGenres.values()].reduce((a, b) => a + b, 0) || 1;
  for (const c of cand.values()){
    const gids = c.r.genre_ids || [];
    let pen = badRec.get(c.key) || 0;
    if (gids.length && disliked.length) pen += 2.5 * gids.reduce((a, g) => a + (badGenre.get(g) || 0), 0) / (nBad * gids.length);
    const boost = gids.length ? 1.5 * gids.reduce((a, g) => a + (likedGenres.get(g) || 0), 0) / (likedTotal) : 0;
    c.penalty = pen;
    c.score += (c.r.vote_average || 0) * 0.6 + Math.min(c.r.vote_count || 0, 3000) / 1500 + boost - pen;
  }
  return [...cand.values()].sort((a, b) => b.score - a.score);
}

// full: Details des Kandidaten, seedFull: Map key → Details der Ausgangstitel
export function reasonsFor(c, full, seedFull, {countryName = "", status = null} = {}){
  const f = full || {genres: [], cast: [], crew: [], created_by: []};
  let best = null;
  for (const s of c.seeds){
    const sf = seedFull.get(s.key); if (!sf) continue;
    const g = (f.genres || []).filter(x => (sf.genres || []).some(y => y.id === x.id)).map(x => x.name);
    const castIds = new Set((sf.cast || []).map(p => p.id));
    const cast = (f.cast || []).filter(p => castIds.has(p.id)).map(p => p.name);
    const dirIds = new Set([...(sf.crew || []).filter(p => p.job === "Director"), ...(sf.created_by || [])].map(p => p.id));
    const dir = [...new Set([...(f.crew || []).filter(p => p.job === "Director"), ...(f.created_by || [])].filter(p => dirIds.has(p.id)).map(p => p.name))];
    const wrIds = new Set((sf.crew || []).filter(p => p.job !== "Director").map(p => p.id));
    const writer = [...new Set((f.crew || []).filter(p => p.job !== "Director" && wrIds.has(p.id)).map(p => p.name))];
    const score = g.length + cast.length * 2 + dir.length * 3 + writer.length * 3;
    if (!best || score > best.score) best = {s, g, cast, dir, writer, score};
  }
  const s = best?.s || c.seeds[0];
  const verb = s.how === "picked" ? "ausgewählt hast" : s.how === "liked" ? "mochtest" : s.how === "seen" ? "gesehen hast" : "auf deiner Liste hast";
  const out = [];
  if (best?.dir.length) out.push(`Gleiche Regie bzw. Idee: ${best.dir.slice(0, 2).join(", ")}`);
  if (best?.writer.length) out.push(`Drehbuch ebenfalls von ${best.writer.slice(0, 2).join(", ")}`);
  if (best?.cast.length) out.push(`Mit ${best.cast.slice(0, 2).join(" und ")}, bekannt aus „${s.title}“`);
  if (best?.g.length) out.push(`Ebenfalls ${best.g.slice(0, 2).join(" und ")}`);
  const others = c.seeds.filter(x => x.key !== s.key);
  if (others.length) out.push(`Passt auch zu „${others[0].title}“${others.length > 1 ? ` und ${others.length - 1} weiteren deiner Titel` : ""}`);
  const va = c.r.vote_average || 0;
  if (va >= 7.5 && (c.r.vote_count || 0) >= 300) out.push(`Hervorragend bewertet: ${num(va)} von 10`);
  else if (va >= 6.8) out.push(`Gut bewertet: ${num(va)} von 10`);
  if (out.length < 2) out.push(`Wer „${s.title}“ mag, schaut laut TMDB oft auch diesen Titel`);
  if (status?.kind === "mine") out.push(`Ohne Zusatzkosten in deinem Abo bei ${status.names.join(", ")}`);
  else if (status?.kind === "flat") out.push(status.text);
  else if (status?.kind === "pay") out.push(`In ${countryName} zum Leihen oder Kaufen`);
  return {why: `Weil du „${s.title}“ ${verb}`, list: out.slice(0, 5)};
}
