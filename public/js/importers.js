// Import aus IMDb, Letterboxd, Titellisten und Streamfinder-Sicherungen. Reine Funktionen, getestet in tests/unit/importers.test.mjs.

export function parseCSV(text){
  const rows = [];
  let row = [], field = "", q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q){
      if (c === '"'){ if (s[i + 1] === '"'){ field += '"'; i++ } else q = false }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n" || c === "\r"){
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x !== "")) rows.push(row);
  return rows;
}

export function detectFormat(header, filename = ""){
  const h = header.map(x => x.trim().toLowerCase()), f = filename.toLowerCase();
  if (h.includes("const")) return h.includes("your rating") ? "imdb-ratings" : "imdb-list";
  if (h.includes("letterboxd uri")){
    if (h.includes("rating") || f.includes("rating") || f.includes("diary")) return "lb-ratings";
    return f.includes("watched") ? "lb-watched" : "lb-list";
  }
  if (h.includes("title") || h.includes("name")) return "generic";
  return null;
}

const IMDB_TV = ["tvseries", "tvminiseries", "tv series", "tv mini series"];
const IMDB_MOVIE = ["movie", "tvmovie", "tv movie", "short", "video", "tvspecial", "tv special"];

// Eine Zeile pro Titel: "Dune (2021)", "1. The Bear", "- Past Lives"
export function parseTitleList(text){
  const out = [], seen = new Set();
  for (let line of String(text).split(/\r?\n/)){
    line = line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").trim();
    if (!line || line.length > 120 || /^https?:/i.test(line)) continue;
    let year = null;
    const m = line.match(/^(.*?)[\s,]*\((\d{4})\)\s*$/) || line.match(/^(.*?)\s+[-–]\s+(\d{4})$/);
    if (m){ line = m[1].trim(); year = +m[2] }
    const k = line.toLowerCase() + "|" + year;
    if (!line || seen.has(k)) continue;
    seen.add(k);
    out.push({title: line, year, strict: true});
  }
  return out;
}

// Wandelt den Dateiinhalt in Suchaufträge um
export function toQueries(text, filename = ""){
  const s = String(text || "").replace(/^﻿/, "").trim();
  if (!s) return {format: null, items: []};
  if (s.startsWith("{")){
    try { const j = JSON.parse(s); if (j && j.app === "streamfinder" && j.data) return {format: "backup", data: j.data, items: []} } catch(e){}
    return {format: null, items: []};
  }
  const rows = parseCSV(s);
  const fmt = rows.length > 1 ? detectFormat(rows[0], filename) : null;
  if (!fmt) return {format: "titles", items: parseTitleList(s)};
  const head = rows[0].map(x => x.trim().toLowerCase());
  const col = name => head.indexOf(name);
  const get = (r, name) => { const i = col(name); return i < 0 ? "" : (r[i] || "").trim() };
  const items = [];
  for (const r of rows.slice(1)){
    if (fmt.startsWith("imdb")){
      const tt = get(r, "const"), kind = get(r, "title type").toLowerCase();
      if (!/^tt\d+$/.test(tt) || kind === "tvepisode" || kind === "tv episode") continue;
      const type = IMDB_TV.includes(kind) ? "tv" : IMDB_MOVIE.includes(kind) || !kind ? "movie" : null;
      if (!type) continue;
      const rating = fmt === "imdb-ratings" ? +get(r, "your rating") || null : null;
      items.push({imdb: tt, type, title: get(r, "title"), year: +get(r, "year") || null, rating, watched: fmt === "imdb-ratings", date: get(r, "date rated") || get(r, "created") || null});
    } else if (fmt.startsWith("lb")){
      const title = get(r, "name"); if (!title) continue;
      const raw = +get(r, "rating");
      items.push({type: "movie", title, year: +get(r, "year") || null, rating: raw ? Math.round(raw * 2) : null,
        watched: fmt !== "lb-list", date: get(r, "watched date") || get(r, "date") || null});
    } else {
      const title = get(r, "title") || get(r, "name"); if (!title) continue;
      const t = (get(r, "type") || get(r, "title type")).toLowerCase();
      items.push({title, year: +get(r, "year") || null, type: /tv|serie/.test(t) ? "tv" : /movie|film/.test(t) ? "movie" : null, strict: false});
    }
  }
  return {format: fmt, items};
}

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
// Wählt aus den Suchergebnissen den passenden Titel
export function pickResult(q, results){
  const list = (results || []).filter(r => !r.media_type || r.media_type === "movie" || r.media_type === "tv");
  const year = r => +String(r.release_date || r.first_air_date || "").slice(0, 4) || null;
  const nameOk = r => [r.title, r.name, r.original_title, r.original_name].some(n => n && norm(n) === norm(q.title));
  const yearOk = r => !q.year || !year(r) || Math.abs(year(r) - q.year) <= 1;
  const exact = list.find(r => nameOk(r) && yearOk(r));
  if (exact) return exact;
  if (q.strict) return null;
  return list.find(yearOk) || null;
}

// Bewertung auf 1–10 → gefällt mir / nicht mein Fall
export const likeFromRating = r => r == null ? 0 : r >= 7 ? 1 : r <= 4 ? -1 : 0;

export function toCSV(rows){
  const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s };
  return rows.map(r => r.map(q).join(",")).join("\r\n") + "\r\n";
}
