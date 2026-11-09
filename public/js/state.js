// Gesamter Zustand der App. Einstellungen und Profile liegen im localStorage,
// der Zwischenspeicher für API-Antworten in IndexedDB (cache.js).
import { emptyProfile, MAIN_PROFILE } from "./merge.js";

export const CFG = globalThis.STREAMFINDER_CONFIG || {};
export const store = {
  get(k){ try { return localStorage.getItem(k) } catch(e){ return null } },
  set(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true } catch(e){ return false } },
  json(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch(e){ return d } }
};
const J = (k, d) => store.json("sf:" + k, d);

export const S = {
  key: J("key", store.get("tmdb_key") || ""),
  proxy: J("proxy", "") || (CFG.proxy || "").trim(),
  sa: J("sa", ""), omdb: J("omdb", ""), sync: J("sync", ""),
  country: J("country", "CH"), mine: J("mine", []), compare: J("compare", ["DE", "AT"]), prices: J("prices", {}),
  profiles: J("profiles", null), pdata: J("pdata", null), ptomb: J("ptomb", {}), setT: J("setT", 0),
  profile: J("profile", "main"), track: J("track", {}), meta: J("meta", {}),
  theme: J("theme", ""), pushOn: J("pushOn", false), curList: J("curList", {}), calLists: J("calLists", true)
};
export const save = k => store.set("sf:" + k, JSON.stringify(S[k]));

// Übernahme aus Version 3 (eine Liste, keine Profile)
if (!S.profiles || !S.pdata){
  const lists = J("lists", null);
  const old = J("watch", []);
  const base = lists || [{id: "main", name: "Merkliste", nt: 0, items: old.map(({lastFlat, lastCountry, isNew, ...w}) => w)}];
  if (base[0] && base[0].id !== "main" && base[0].name === "Merkliste" && !base.some(l => l.id === "main")) base[0].id = "main";
  S.profiles = [MAIN_PROFILE()];
  S.pdata = {main: emptyProfile({lists: base, watched: J("watched", {}), progress: J("progress", {}), tomb: J("tomb", {})})};
  save("profiles"); save("pdata");
  for (const k of ["lists", "watched", "progress", "tomb", "watch", "updated"]) store.set("sf:" + k, null);
}
if (typeof S.curList !== "object" || !S.curList) S.curList = {};
for (const p of S.profiles) S.pdata[p.id] = emptyProfile(S.pdata[p.id] || {});
if (!S.profiles.some(p => p.id === S.profile)) S.profile = S.profiles[0].id;

export const P = () => S.pdata[S.profile] || (S.pdata[S.profile] = emptyProfile());
export const profile = () => S.profiles.find(p => p.id === S.profile) || S.profiles[0];
export const hasAuth = () => !!(S.key || S.proxy);
export const proxyBase = () => S.proxy.replace(/\/+$/, "");

// Ereignisse zwischen den Modulen
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, {detail}));
export const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));

export const SYNC_FIELDS = ["profiles", "pdata", "ptomb", "mine", "country", "compare", "prices", "setT"];
const SETTINGS = ["mine", "country", "compare", "prices"];
export function changed(k){
  save(k);
  if (SETTINGS.includes(k)){ S.setT = Date.now(); save("setT") }
  if (SYNC_FIELDS.includes(k)) emit("dirty", k);
}
export const touch = () => changed("pdata");

// Altersgrenze des aktiven Profils (null = keine)
export const profileFsk = () => { const v = profile().maxFsk; return v === null || v === undefined || v === "" ? null : +v };
