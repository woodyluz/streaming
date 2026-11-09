// Stimmungssuche: freier Text → Filter für TMDB. Ohne KI per Stichworten, mit KI (Worker) wird die Antwort geprüft.
// Reine Funktionen, getestet in tests/unit/mood.test.mjs.

const N = s => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

// Stichwort → Genres für Filme und Serien
const MOODS = [
  [/spannend|thriller|nervenkitzel|packend|mitfiebern/, [53], [9648, 80], "spannend"],
  [/lustig|komoedie|komisch|witzig|lachen|humor|leicht(e|es)?\b|locker/, [35], [35], "lustig"],
  [/gruselig|horror|angst|schocker/, [27], [9648], "gruselig"],
  [/romanti|liebe|romanze|herz/, [10749], [18], "romantisch"],
  [/action|explosion|verfolgungsjagd/, [28], [10759], "Action"],
  [/krimi|verbrechen|mord|detektiv|ermittl|raub|heist/, [80], [80], "Krimi"],
  [/doku|dokumentation|wahre begebenheit|echte geschichte/, [99], [99], "Doku"],
  [/famil|kinder|kindgerecht/, [10751], [10751, 10762], "Familie"],
  [/animation|zeichentrick|anime|animiert/, [16], [16], "Animation"],
  [/science.?fiction|sci.?fi|weltraum|zukunft|aliens?|roboter/, [878], [10765], "Science-Fiction"],
  [/fantasy|magie|zauber|drachen/, [14], [10765], "Fantasy"],
  [/drama|bewegend|traurig|tiefgruendig|emotional|nachdenklich/, [18], [18], "bewegend"],
  [/abenteuer/, [12], [10759], "Abenteuer"],
  [/krieg/, [10752], [10768], "Krieg"],
  [/western/, [37], [37], "Western"],
  [/musik|musical|konzert/, [10402], [], "Musik"],
  [/historisch|geschichte|mittelalter/, [36], [10768], "historisch"],
  [/mystery|raetsel|geheimnis/, [9648], [9648], "Mystery"]
];
const NEG = /(nicht|kein(e|en)?|ohne)\s+(zu\s+)?/;

export function parseMood(text, now = new Date()){
  const t = N(text);
  const f = {type: null, genres: {movie: [], tv: []}, without: {movie: [], tv: []}, runtimeMax: null, runtimeMin: null,
    yearMin: null, yearMax: null, voteMin: null, voteCountMax: null, fskMax: null, lang: null, country: null, understood: [], notes: []};
  if (/\bserien?\b|staffel|folgen\b|binge/.test(t)) { f.type = "tv"; f.understood.push("Serie") }
  else if (/\bfilme?\b|movie/.test(t)) { f.type = "movie"; f.understood.push("Film") }

  for (const [re, mv, tv, label] of MOODS){
    const m = t.match(new RegExp("(" + NEG.source + ")?(" + re.source + ")"));
    if (!m) continue;
    const negated = !!m[1];
    const target = negated ? f.without : f.genres;
    target.movie.push(...mv); target.tv.push(...tv);
    f.understood.push((negated ? "kein " : "") + label);
  }
  if (/nicht (zu )?brutal|ohne gewalt|harmlos|nicht zu heftig|sanft/.test(t)){ f.fskMax = 12; f.without.movie.push(27); f.understood.push("nicht zu brutal (bis FSK 12)") }
  if (/kindgerecht|fuer kinder|mit (den )?kindern|ab 6\b/.test(t)){ f.fskMax = 6; f.understood.push("für Kinder (bis FSK 6)") }
  else if (/ab 12\b|mit teenager/.test(t) && f.fskMax === null){ f.fskMax = 12; f.understood.push("bis FSK 12") }

  let m;
  if ((m = t.match(/unter (\d+(?:[.,]\d+)?|einer|eine|zwei|drei) ?(stunden?|std|h\b)/))){
    const v = {einer: 1, eine: 1, zwei: 2, drei: 3}[m[1]] ?? parseFloat(m[1].replace(",", "."));
    f.runtimeMax = Math.round(v * 60); f.understood.push(`unter ${f.runtimeMax} Minuten`);
  } else if ((m = t.match(/unter (\d+) ?(minuten|min)/))){ f.runtimeMax = +m[1]; f.understood.push(`unter ${f.runtimeMax} Minuten`) }
  else if (/nicht zu lang|\bkurz/.test(t)){ f.runtimeMax = f.type === "tv" ? 35 : 105; f.understood.push(f.type === "tv" ? "kurze Folgen" : "nicht zu lang") }
  else if (/\blang(er|e)?\b|epos|episch/.test(t) && !/nicht/.test(t)){ f.runtimeMin = 140; f.understood.push("lang") }

  const year = now.getFullYear();
  if ((m = t.match(/(19|20)?(\d)0er/))){ const d = +m[2], c = m[1] ? +m[1] * 100 : (d >= 3 ? 1900 : 2000); f.yearMin = c + d * 10; f.yearMax = f.yearMin + 9; f.understood.push(`aus den ${m[0]}`) }
  else if ((m = t.match(/(?:ab|nach|seit) ((?:19|20)\d\d)/))){ f.yearMin = +m[1]; f.understood.push(`ab ${m[1]}`) }
  else if (/klassiker|alt(er|e)? film|zeitlos/.test(t)){ f.yearMax = 1999; f.voteMin = 7.5; f.understood.push("Klassiker") }
  else if (/\bneu(e|er|es)?\b|aktuell|frisch|gerade erschienen/.test(t)){ f.yearMin = year - 2; f.understood.push(`neu (ab ${year - 2})`) }

  if (/geheimtipp|unbekannt|unterschaetzt|nicht so bekannt/.test(t)){ f.voteMin = Math.max(f.voteMin || 0, 7); f.voteCountMax = 1500; f.understood.push("Geheimtipp") }
  else if (/gut bewertet|meisterwerk|top|bester|beste|preisgekroent|oscar/.test(t)){ f.voteMin = Math.max(f.voteMin || 0, 7.5); f.understood.push("sehr gut bewertet") }

  const LANG = [[/schweizer|aus der schweiz/, null, "CH", "aus der Schweiz"], [/deutsche[rn]? (film|serie|produktion)|aus deutschland/, "de", null, "deutsche Produktion"],
    [/franzoesisch/, "fr", null, "französisch"], [/koreanisch/, "ko", null, "koreanisch"], [/japanisch/, "ja", null, "japanisch"],
    [/skandinavisch|schwedisch|daenisch|norwegisch/, "sv|da|no", null, "skandinavisch"], [/spanisch/, "es", null, "spanisch"], [/italienisch/, "it", null, "italienisch"]];
  for (const [re, lang, country, label] of LANG) if (re.test(t)){ f.lang = lang; f.country = country; f.understood.push(label); break }
  if (/auf deutsch|deutsche (tonspur|synchro)/.test(t)) f.notes.push("Ob es eine deutsche Tonspur gibt, siehst du in den Details unter „Direkt ansehen“.");

  for (const k of ["movie", "tv"]){ f.genres[k] = [...new Set(f.genres[k])].filter(g => !f.without[k].includes(g)); f.without[k] = [...new Set(f.without[k])] }
  if (!f.understood.length) f.notes.push("Ich habe keine bekannten Stichworte gefunden und zeige gut bewertete Titel aus deinen Diensten.");
  return f;
}

// Antwort der KI absichern: nur bekannte Felder, plausible Werte
export function sanitizeMood(x){
  const ids = a => Array.isArray(a) ? a.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 100000).slice(0, 8) : [];
  const n = (v, lo, hi) => { const z = Number(v); return Number.isFinite(z) && z >= lo && z <= hi ? z : null };
  const f = {
    type: x?.type === "tv" || x?.type === "movie" ? x.type : null,
    genres: {movie: ids(x?.genres?.movie), tv: ids(x?.genres?.tv)},
    without: {movie: ids(x?.without?.movie), tv: ids(x?.without?.tv)},
    runtimeMax: n(x?.runtimeMax, 10, 400), runtimeMin: n(x?.runtimeMin, 10, 400),
    yearMin: n(x?.yearMin, 1900, 2100), yearMax: n(x?.yearMax, 1900, 2100),
    voteMin: n(x?.voteMin, 0, 10), voteCountMax: n(x?.voteCountMax, 10, 1e7), fskMax: [0, 6, 12, 16].includes(Number(x?.fskMax)) ? Number(x.fskMax) : null,
    lang: typeof x?.lang === "string" && /^[a-z]{2}(\|[a-z]{2})*$/.test(x.lang) ? x.lang : null,
    country: typeof x?.country === "string" && /^[A-Z]{2}$/.test(x.country) ? x.country : null,
    understood: Array.isArray(x?.understood) ? x.understood.map(String).map(s => s.slice(0, 60)).slice(0, 8) : [],
    notes: Array.isArray(x?.notes) ? x.notes.map(String).map(s => s.slice(0, 200)).slice(0, 3) : []
  };
  return f;
}

// Filter → Parameter für /discover
export function moodParams(f, type){
  const p = {};
  if (f.genres[type].length) p.with_genres = f.genres[type].join("|");
  if (f.without[type].length) p.without_genres = f.without[type].join(",");
  if (f.runtimeMax) p["with_runtime.lte"] = f.runtimeMax;
  if (f.runtimeMin) p["with_runtime.gte"] = f.runtimeMin;
  const dk = type === "tv" ? "first_air_date" : "primary_release_date";
  if (f.yearMin) p[dk + ".gte"] = f.yearMin + "-01-01";
  if (f.yearMax) p[dk + ".lte"] = f.yearMax + "-12-31";
  p["vote_average.gte"] = f.voteMin ?? 6.5;
  p["vote_count.gte"] = f.voteCountMax ? 80 : (type === "tv" ? 100 : 200);
  if (f.voteCountMax) p["vote_count.lte"] = f.voteCountMax;
  if (f.lang) p.with_original_language = f.lang;
  if (f.country) p.with_origin_country = f.country;
  if (type === "movie" && f.fskMax !== null){ p.certification_country = "DE"; p["certification.lte"] = f.fskMax }
  p.sort_by = f.voteCountMax ? "vote_average.desc" : "popularity.desc";
  return p;
}
