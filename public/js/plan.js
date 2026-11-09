// Abo-Planer: welcher Dienst in welchem Monat. Reine Funktionen, getestet in tests/unit/plan.test.mjs.
//
// Idee: Man abonniert pro Monat einen Dienst, schaut dort möglichst viel von den eigenen Listen,
// kündigt und wechselt. Titel, die bald auslaufen, kommen zuerst dran.

const flat = r => r ? [...(r.flatrate || []), ...(r.ads || [])] : [];
const free = r => r ? (r.free || []) : [];

// items: [{key, title}], regions: Map key → Anbieter-Objekt, expiry: Map "key|providerId" → Unix-Sekunden
export function planSubscriptions({items, regions, mine = [], prices = {}, perMonth = 8, months = 3, expiry = new Map(), now = Date.now()}){
  const names = new Map(), logos = new Map();
  const freeTitles = [], rest = [];
  for (const it of items){
    const r = regions.get(it.key);
    for (const p of [...flat(r), ...free(r)]){ names.set(p.provider_id, p.provider_name); logos.set(p.provider_id, p.logo_path) }
    const f = free(r);
    if (f.length) freeTitles.push({...it, services: [...new Set(f.map(p => p.provider_name))]});
    else rest.push(it);
  }
  const knownPrices = Object.values(prices).map(Number).filter(v => v > 0).sort((a, b) => a - b);
  const fallbackPrice = knownPrices.length ? knownPrices[Math.floor(knownPrices.length / 2)] : 15;
  const priceOf = id => +prices[id] > 0 ? +prices[id] : null;
  let left = rest.slice();
  const plan = [];
  for (let m = 0; m < months; m++){
    const start = new Date(now); start.setDate(1); start.setMonth(start.getMonth() + m);
    const end = new Date(start); end.setMonth(end.getMonth() + 1);
    const byService = new Map();
    for (const it of left){
      for (const p of flat(regions.get(it.key))){
        const exp = expiry.get(it.key + "|" + p.provider_id);
        if (exp && exp * 1000 < start.getTime()) continue;           // dann schon weg
        const soon = !!exp && exp * 1000 < end.getTime();
        if (!byService.has(p.provider_id)) byService.set(p.provider_id, []);
        byService.get(p.provider_id).push({...it, soon, exp: exp || null});
      }
    }
    let best = null;
    for (const [id, list] of byService){
      list.sort((a, b) => (b.soon - a.soon) || ((a.exp || 9e12) - (b.exp || 9e12)));
      const take = list.slice(0, perMonth);
      const weight = take.reduce((a, t) => a + (t.soon ? 2 : 1), 0);
      const price = priceOf(id);
      const score = weight / (price || fallbackPrice) + (mine.includes(id) ? 0.01 : 0);
      if (!best || score > best.score) best = {id, take, score, total: list.length, price};
    }
    if (!best) break;
    const taken = new Set(best.take.map(t => t.key));
    left = left.filter(it => !taken.has(it.key));
    plan.push({month: start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0"), service: best.id, name: names.get(best.id) || "Dienst",
      logo: logos.get(best.id) || null, price: best.price, titles: best.take, more: best.total - best.take.length, mine: mine.includes(best.id)});
  }
  const used = new Set(plan.map(p => p.service));
  const cancel = mine.filter(id => !used.has(id)).map(id => ({id, name: names.get(id) || null, price: priceOf(id),
    count: items.filter(it => flat(regions.get(it.key)).some(p => p.provider_id === id)).length}));
  const costPlan = plan.reduce((a, p) => a + (p.price || 0), 0);
  const costNow = mine.reduce((a, id) => a + (priceOf(id) || 0), 0) * plan.length;
  const unpriced = plan.some(p => !p.price) || mine.some(id => !priceOf(id));
  return {free: freeTitles, months: plan, cancel, costPlan, costNow, unpriced, notStreaming: left.filter(it => !flat(regions.get(it.key)).length).length};
}
