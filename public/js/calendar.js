// Serien-Kalender: offene Folgen berechnen, nach Tagen gruppieren, Kalenderdatei erzeugen.
// Reine Funktionen, getestet in tests/unit/calendar.test.mjs.

const sumEps = (seasons, s, e) => seasons.filter(x => x.n < s).reduce((a, x) => a + x.c, 0) + e;

// f: Seriendetails (seasons, next, last), pr: Stand {s, e}
export function episodeInfo(f, pr){
  const seasons = f.seasons || [];
  const aired = f.last ? sumEps(seasons, f.last.s, f.last.e) : 0;
  const done = pr ? sumEps(seasons, pr.s, pr.e) : 0;
  return {aired, done, unseen: pr ? Math.max(0, aired - done) : 0, next: f.next || null, last: f.last || null, started: !!pr};
}

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const at = s => new Date(s + "T12:00:00Z");
export function dayLabel(date, today){
  const diff = Math.round((at(date) - at(today)) / 864e5);
  const d = at(date);
  const dm = d.toLocaleDateString("de-CH", {day: "numeric", month: "long", timeZone: "UTC"});
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff > 1 && diff < 7) return `${WEEKDAYS[d.getUTCDay()]}, ${dm}`;
  return d.toLocaleDateString("de-CH", {day: "numeric", month: "long", year: "numeric", timeZone: "UTC"});
}

// entries: [{date: "YYYY-MM-DD", ...}] → [{date, label, items}]
export function groupByDate(entries, today){
  const m = new Map();
  for (const e of [...entries].filter(e => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(String(b.title)))){
    if (!m.has(e.date)) m.set(e.date, []);
    m.get(e.date).push(e);
  }
  return [...m.entries()].map(([date, items]) => ({date, label: dayLabel(date, today), items}));
}

const icsText = s => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = s => s.replace(/-/g, "");
function nextDay(s){ const d = at(s); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
// Zeilen über 75 Zeichen umbrechen (RFC 5545)
const fold = line => line.length <= 74 ? line : line.match(/.{1,74}/g).join("\r\n ");

export function buildICS(events, now = new Date()){
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Streamfinder//Serien-Kalender//DE", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Streamfinder Serien"];
  for (const e of events){
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@streamfinder`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDay(e.date))}`, fold(`SUMMARY:${icsText(e.title)}`));
    if (e.desc) lines.push(fold(`DESCRIPTION:${icsText(e.desc)}`));
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
