// Zusammenführen zweier Datenstände (Gerät und Server). Reine Funktionen, getestet in tests/unit/merge.test.mjs.
// Grundsatz: Nichts geht verloren. Gelöscht wird nur, was vor dem Löschzeitpunkt hinzugefügt wurde.

const KEEP = 90 * 864e5;           // Löschvermerke werden 90 Tage aufbewahrt
const TOMB_KEYS = ["items", "lists", "watched", "progress", "follow", "pwatch"];
const newer = (a, b) => (a || 0) > (b || 0);

export const MAIN_PROFILE = () => ({id: "main", name: "Ich", nt: 0, maxFsk: null});

export function emptyProfile(p = {}){
  const t = p.tomb || {};
  const lists = Array.isArray(p.lists) && p.lists.length ? p.lists : [{id: "main", name: "Merkliste", nt: 0, items: []}];
  const tomb = {};
  for (const k of TOMB_KEYS) tomb[k] = {...(t[k] || {})};
  return {lists, watched: p.watched || {}, progress: p.progress || {}, follow: p.follow || {}, pwatch: p.pwatch || {}, tomb};
}

export function mergeTomb(a = {}, b = {}, now = Date.now()){
  const out = {};
  for (const k of TOMB_KEYS){
    out[k] = {};
    for (const src of [a[k] || {}, b[k] || {}])
      for (const [id, t] of Object.entries(src)) if (t > now - KEEP && newer(t, out[k][id])) out[k][id] = t;
  }
  return out;
}

function byKey(a = {}, b = {}, tomb = {}){
  const out = {};
  for (const src of [a, b]) for (const [k, v] of Object.entries(src)) if (v && (!out[k] || newer(v.t, out[k].t))) out[k] = v;
  for (const k of Object.keys(out)) if ((tomb[k] || 0) >= (out[k].t || 0)) delete out[k];
  return out;
}

export function mergeProfile(Lin, Rin, now = Date.now()){
  const L = emptyProfile(Lin || {}), R = emptyProfile(Rin || {});
  const T = mergeTomb(L.tomb, R.tomb, now);
  const byId = new Map();
  for (const l of [...L.lists, ...R.lists]){
    if (T.lists[l.id]) continue;
    const cur = byId.get(l.id);
    if (!cur){ byId.set(l.id, {id: l.id, name: l.name, nt: l.nt || 0, items: [...(l.items || [])], ...(l.collab ? {collab: l.collab, own: !!l.own} : {})}); continue }
    if (newer(l.nt, cur.nt)){ cur.name = l.name; cur.nt = l.nt; if (l.collab){ cur.collab = l.collab; cur.own = !!l.own } else { delete cur.collab; delete cur.own } }
    const m = new Map(cur.items.map(i => [i.key, i]));
    for (const i of l.items || []){ const p = m.get(i.key); if (!p || newer(i.added, p.added)) m.set(i.key, i) }
    cur.items = [...m.values()];
  }
  let lists = [...byId.values()];
  for (const l of lists)
    l.items = l.items.filter(i => !((T.items[l.id + "|" + i.key] || 0) >= (i.added || 0))).sort((a, b) => (b.added || 0) - (a.added || 0));
  lists.sort((a, b) => (b.id === "main") - (a.id === "main"));
  if (!lists.length) lists = [{id: "main", name: "Merkliste", nt: 0, items: []}];
  return {
    lists,
    watched: byKey(L.watched, R.watched, T.watched),
    progress: byKey(L.progress, R.progress, T.progress),
    follow: byKey(L.follow, R.follow, T.follow),
    pwatch: byKey(L.pwatch, R.pwatch, T.pwatch),
    tomb: T
  };
}

// Ältere Stände (eine Merkliste ohne Profile) in das Profil-Format bringen
export function upgrade(d){
  if (!d || typeof d !== "object") return {};
  if (d.pdata) return d;
  if (d.lists || d.watched || d.progress){
    return {profiles: [MAIN_PROFILE()], pdata: {main: emptyProfile({lists: d.lists, watched: d.watched, progress: d.progress, tomb: d.tomb})},
      ptomb: {}, mine: d.mine, country: d.country, compare: d.compare, prices: d.prices, setT: d.setT ?? 0};
  }
  return d;
}

export function mergeAll(Lin, Rin, now = Date.now()){
  const L = upgrade(Lin), R = upgrade(Rin);
  const ptomb = {};
  for (const src of [L.ptomb || {}, R.ptomb || {}])
    for (const [id, t] of Object.entries(src)) if (t > now - KEEP && newer(t, ptomb[id])) ptomb[id] = t;
  const pm = new Map();
  for (const p of [...(L.profiles || []), ...(R.profiles || [])]){
    if (ptomb[p.id] && p.id !== "main") continue;
    const cur = pm.get(p.id);
    if (!cur) pm.set(p.id, {...p});
    else if (newer(p.nt, cur.nt)) Object.assign(cur, p);
  }
  if (!pm.has("main")) pm.set("main", MAIN_PROFILE());
  const profiles = [...pm.values()].sort((a, b) => (b.id === "main") - (a.id === "main"));
  const pdata = {};
  for (const p of profiles) pdata[p.id] = mergeProfile(L.pdata?.[p.id], R.pdata?.[p.id], now);
  const s = newer(R.setT, L.setT) ? R : L;
  return {
    profiles, pdata, ptomb,
    mine: s.mine ?? L.mine ?? R.mine ?? [],
    country: s.country ?? L.country ?? R.country ?? "CH",
    compare: s.compare ?? L.compare ?? R.compare ?? [],
    prices: s.prices ?? L.prices ?? R.prices ?? {},
    household: s.household ?? L.household ?? R.household ?? {},
    city: s.city ?? L.city ?? R.city ?? "",
    setT: Math.max(L.setT || 0, R.setT || 0)
  };
}

// Sicherung zurückholen: Löschvermerke für alles, was in der Sicherung steht, aufheben, dann zusammenführen
export function restoreFrom(local, backup, now = Date.now()){
  const B = upgrade(backup), L = JSON.parse(JSON.stringify(upgrade(local)));
  for (const [pid, bp] of Object.entries(B.pdata || {})){
    const lp = L.pdata?.[pid]; if (!lp || !lp.tomb) continue;
    for (const l of bp.lists || []){
      delete lp.tomb.lists?.[l.id];
      for (const i of l.items || []) delete lp.tomb.items?.[l.id + "|" + i.key];
    }
    for (const k of ["watched", "progress", "follow", "pwatch"]) for (const key of Object.keys(bp[k] || {})) delete lp.tomb[k]?.[key];
  }
  for (const id of Object.keys(B.pdata || {})) delete L.ptomb?.[id];
  // Wiederhergestellte Einträge gelten als neu, damit spätere Löschungen auf anderen Geräten sie nicht sofort wieder entfernen
  const fresh = JSON.parse(JSON.stringify(B));
  for (const bp of Object.values(fresh.pdata || {})) for (const l of bp.lists || []){ l.nt = now; for (const i of l.items || []) i.added = Math.max(i.added || 0, now - 1) }
  return mergeAll(L, fresh, now);
}
