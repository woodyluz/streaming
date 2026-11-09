// Kleine Helfer ohne Abhängigkeiten. Nichts hier greift beim Laden auf das DOM zu,
// damit die reinen Funktionen auch in Node getestet werden können.

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function isoLocal(d = new Date()){
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4);
  return z.toISOString().slice(0, 10);
}
export const iso = days => isoLocal(new Date(Date.now() + days * 864e5));
export const fromIso = s => new Date(s + "T12:00:00");
export function fmtDate(v, long){
  const d = typeof v === "number" ? new Date(v < 1e11 ? v * 1000 : v) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? fromIso(v) : new Date(v);
  return d.toLocaleDateString("de-CH", long ? {day:"numeric", month:"long", year:"numeric"} : {day:"numeric", month:"short"});
}
export const num = v => (+v).toFixed(1).replace(".", ",");
export const normName = s => String(s || "").toLowerCase().replace(/\bplus\b/g, "+").replace(/[^a-z0-9+]/g, "");
export const normTitle = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
export const titleOf = it => it.title || it.name || "";
export const yearOf = it => String(it.release_date || it.first_air_date || it.year || "").slice(0, 4);
export const short = (s, n) => s && s.length > n ? s.slice(0, n).replace(/\s\S*$/, "") + " …" : s;

export async function pool(list, n, fn){
  let i = 0;
  await Promise.all(Array.from({length: Math.min(n, list.length)}, async () => { while (i < list.length) await fn(list[i++]) }));
}
export function debounce(fn, ms){
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) };
}
export function toast(msg){
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.hidden = true, 2800);
}
export function download(name, text, mime = "text/plain"){
  const url = URL.createObjectURL(new Blob([text], {type: mime + ";charset=utf-8"}));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function copy(text){
  try { await navigator.clipboard.writeText(text); return true } catch(e){ return false }
}
