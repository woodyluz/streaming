// Zwischenspeicher in IndexedDB (kein 5-MB-Limit wie localStorage), davor ein kleiner Speicher im Arbeitsspeicher.
// Fällt IndexedDB aus (privates Fenster), läuft alles nur im Arbeitsspeicher weiter.

const mem = new Map();
let dbp = null;

function db(){
  if (dbp) return dbp;
  dbp = new Promise(res => {
    try {
      const r = indexedDB.open("streamfinder", 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore("c", {keyPath: "k"}); s.createIndex("t", "t") };
      r.onsuccess = () => res(r.result);
      r.onerror = r.onblocked = () => res(null);
    } catch(e){ res(null) }
  });
  return dbp;
}
async function tx(mode, fn){
  const d = await db();
  if (!d) return undefined;
  return new Promise(res => {
    try {
      const t = d.transaction("c", mode);
      const req = fn(t.objectStore("c"));
      t.oncomplete = () => res(req && req.result);
      t.onerror = t.onabort = () => res(undefined);
    } catch(e){ res(undefined) }
  });
}

// Liefert undefined, wenn nichts (Frisches) da ist. null ist ein gültiger gespeicherter Wert.
export async function cget(k, ttl){
  let e = mem.get(k);
  if (!e){ e = await tx("readonly", s => s.get(k)); if (e) remember(e) }
  return e && Date.now() - e.t < ttl ? e.d : undefined;
}
export function cset(k, d){
  const e = {k, t: Date.now(), d};
  remember(e);
  tx("readwrite", s => s.put(e));
}
function remember(e){
  mem.set(e.k, e);
  if (mem.size > 2000) mem.delete(mem.keys().next().value);
}
export async function cclear(){
  mem.clear();
  await tx("readwrite", s => s.clear());
}
// Alte Einträge löschen und die Gesamtzahl begrenzen
export async function cprune(maxAge = 10 * 864e5, max = 6000){
  await tx("readwrite", s => {
    const req = s.index("t").openCursor(IDBKeyRange.upperBound(Date.now() - maxAge));
    req.onsuccess = () => { const c = req.result; if (c){ c.delete(); c.continue() } };
    return req;
  });
  const n = await tx("readonly", s => s.count());
  if (n > max){
    let left = n - max;
    await tx("readwrite", s => {
      const req = s.index("t").openCursor();
      req.onsuccess = () => { const c = req.result; if (c && left-- > 0){ c.delete(); c.continue() } };
      return req;
    });
  }
}
// Zwischenspeicher der Version 3 aus dem localStorage entfernen
export function dropLegacy(){
  try { Object.keys(localStorage).filter(k => k.startsWith("sfc:")).forEach(k => localStorage.removeItem(k)) } catch(e){}
}
