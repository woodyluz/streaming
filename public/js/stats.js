// Auswertungen für die Statistik. Reine Funktionen, getestet in tests/unit/stats.test.mjs.

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

const epsDone = (f, pr) => pr ? f.seasons.filter(s => s.n < pr.s).reduce((a, s) => a + s.c, 0) + pr.e : 0;
const epsAll = f => (f.seasons || []).reduce((a, s) => a + s.c, 0);

// watched: Einträge {key, type, t, like}, full: Map key → Details, progress: {key: {s, e}}
export function overview(watched, full, progress){
  let movies = 0, minutes = 0, episodes = 0;
  const series = new Set();
  for (const w of watched){
    const f = full.get(w.key);
    if (w.type === "movie"){ movies++; minutes += f?.runtime || 0 }
    else if (w.type === "tv"){ series.add(w.key); if (f && !progress[w.key]){ const n = epsAll(f); episodes += n; minutes += n * (f.episode_run_time?.[0] || 40) } }
  }
  for (const [k, pr] of Object.entries(progress)){
    if (!k.startsWith("tv:")) continue;
    series.add(k);
    const f = full.get(k); if (!f) continue;
    const n = epsDone(f, pr); episodes += n; minutes += n * (f.episode_run_time?.[0] || 40);
  }
  return {movies, series: series.size, episodes, hours: Math.round(minutes / 60)};
}

export function byMonth(watched, now = new Date(), n = 12){
  const out = [];
  for (let i = n - 1; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: MONTHS[d.getMonth()], count: 0});
  }
  const idx = new Map(out.map((m, i) => [m.key, i]));
  for (const w of watched){
    const d = new Date(w.t), k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    if (idx.has(k)) out[idx.get(k)].count++;
  }
  return out;
}

export function topGenres(watched, full, n = 8){
  const m = new Map();
  for (const w of watched){
    for (const g of full.get(w.key)?.genres || []){
      const e = m.get(g.name) || {name: g.name, count: 0, liked: 0};
      e.count++; if (w.like === 1) e.liked++;
      m.set(g.name, e);
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.liked - a.liked).slice(0, n);
}

export function topPeople(watched, full, n = 6){
  const m = new Map();
  const add = (p, role) => { const e = m.get(p.id) || {id: p.id, name: p.name, count: 0, role}; e.count++; m.set(p.id, e) };
  for (const w of watched){
    const f = full.get(w.key); if (!f) continue;
    const seen = new Set();
    for (const p of [...(f.crew || []).filter(p => p.job === "Director"), ...(f.created_by || [])]) if (!seen.has(p.id)){ seen.add(p.id); add(p, "Regie") }
    for (const p of (f.cast || []).slice(0, 5)) if (!seen.has(p.id)){ seen.add(p.id); add(p, "Schauspiel") }
  }
  return [...m.values()].filter(e => e.count >= 2).sort((a, b) => b.count - a.count).slice(0, n);
}

// items: [{key, title}], regions: Map key → Anbieter-Objekt, mine: [ids], prices: {id: CHF}
export function serviceValue(items, regions, mine, prices = {}){
  const flat = r => r ? [...(r.flatrate || []), ...(r.free || []), ...(r.ads || [])] : [];
  const names = new Map(), logos = new Map(), cover = new Map();
  for (const it of items){
    const ps = [...new Map(flat(regions.get(it.key)).map(p => [p.provider_id, p])).values()];
    for (const p of ps){
      names.set(p.provider_id, p.provider_name); logos.set(p.provider_id, p.logo_path);
      if (!cover.has(p.provider_id)) cover.set(p.provider_id, []);
      cover.get(p.provider_id).push(it.key);
    }
  }
  const mineSet = new Set(mine);
  const rows = mine.map(id => {
    const keys = cover.get(id) || [];
    const exclusive = keys.filter(k => !flat(regions.get(k)).some(p => p.provider_id !== id && mineSet.has(p.provider_id))).length;
    const price = +prices[id] || 0;
    return {id, name: names.get(id) || null, logo: logos.get(id) || null, count: keys.length, exclusive, price, perTitle: price && keys.length ? price / keys.length : null};
  }).sort((a, b) => b.count - a.count);
  const others = [...cover.entries()].filter(([id, k]) => !mineSet.has(id) && k.length >= 2)
    .map(([id, k]) => ({id, name: names.get(id), logo: logos.get(id), count: k.length})).sort((a, b) => b.count - a.count).slice(0, 5);
  const covered = new Set(rows.flatMap(r => cover.get(r.id) || []));
  return {rows, others, total: items.length, covered: covered.size};
}

export function verdict(sv){
  if (!sv.rows.length) return "";
  const best = sv.rows[0], worst = sv.rows[sv.rows.length - 1];
  const parts = [];
  if (best.count) parts.push(`${best.name || "Dein meistgenutzter Dienst"} lohnt sich am meisten: ${best.count} Titel aus deinen Listen und Serien laufen dort${best.exclusive ? `, ${best.exclusive} davon nur dort` : ""}.`);
  if (sv.rows.length > 1 && worst !== best){
    parts.push(worst.count <= 1
      ? `${worst.name || "Ein Dienst"} bringt dir gerade ${worst.count ? "nur einen Titel" : "keinen Titel"}. Hier könnte sich Kündigen lohnen.`
      : `${worst.name} hat mit ${worst.count} Titeln am wenigsten für dich.`);
  }
  if (sv.others[0]) parts.push(`Nicht abonniert: Bei ${sv.others[0].name} liefen ${sv.others[0].count} deiner Titel.`);
  return parts.join(" ");
}
