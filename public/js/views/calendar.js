// Serien-Kalender: neue Folgen, Termine, Kalenderdatei
import { S, P, save, on } from "../state.js";
import { $, esc, iso, pool, download, toast } from "../util.js";
import { titleFull } from "../api.js";
import { followedSeries, statusOf } from "../data.js";
import { cardHTML, decorate } from "../cards.js";
import { episodeInfo, groupByDate, buildICS } from "../calendar.js";
import { register, current } from "../router.js";

let last = [];
const epLabel = e => `S${e.s} · F${e.e}${e.name && !/^(Folge|Episode) \d+$/i.test(e.name) ? " · " + e.name : ""}`;
function chipFor(f){
  const s = statusOf((f.providers || {})[S.country] || null);
  if (s.kind === "none" && f.networks?.length) return {kind: "none", text: f.networks[0]};
  return {kind: s.kind, text: s.text};
}

async function renderCalendar(){
  $("k-lists").checked = S.calLists;
  const series = followedSeries(S.calLists);
  const box = $("k-box");
  if (!series.length){
    $("k-status").textContent = "";
    box.innerHTML = `<p class="hint">Noch keine Serien. Tippe in den Details einer Serie auf „Folgen“ oder trag deinen Stand ein. Serien auf deinen Listen erscheinen hier auch.</p>`;
    last = []; return;
  }
  $("k-status").textContent = `Prüfe ${series.length} Serien …`;
  const rows = [];
  await pool(series, 4, async s => { try { rows.push({s, f: await titleFull("tv", s.id)}) } catch(e){} });
  if (current() !== "kalender") return;
  const today = iso(0), pd = P();
  const behind = [], upcoming = [], waiting = [], ended = [];
  for (const {s, f} of rows){
    const info = episodeInfo(f, pd.progress[s.key]);
    const base = {media_type: "tv", id: f.id, title: f.title, poster_path: f.poster_path, year: (f.first_air_date || "").slice(0, 4)};
    if (info.started && info.unseen > 0) behind.push({base, f, info});
    if (info.next?.date && info.next.date >= today) upcoming.push({date: info.next.date, title: f.title, base, f, info});
    else if (/ended|canceled/i.test(f.status || "")) ended.push({base, f});
    else waiting.push({base, f});
  }
  last = upcoming;
  behind.sort((a, b) => b.info.unseen - a.info.unseen);
  const groups = groupByDate(upcoming, today);
  const row = (it, meta, chip) => cardHTML(it, {row: true, meta, chip});
  let html = "";
  if (behind.length) html += `<section class="section" aria-labelledby="kh-behind"><h2 class="sec" id="kh-behind">Neue Folgen für dich</h2><p class="sub">Schon erschienen, aber noch nicht gesehen</p><div class="toplist" role="list">${
    behind.map(x => row(x.base, `${x.info.unseen} ${x.info.unseen === 1 ? "neue Folge" : "neue Folgen"} · zuletzt ${epLabel(x.info.last)}`, chipFor(x.f))).join("")}</div></section>`;
  html += `<section class="section" aria-labelledby="kh-up"><h2 class="sec" id="kh-up">Demnächst</h2>`;
  html += groups.length ? groups.map(g => `<div class="daygroup"><h3>${esc(g.label)}</h3><div class="toplist" role="list">${
    g.items.map(x => row(x.base, epLabel(x.info.next), chipFor(x.f))).join("")}</div></div>`).join("")
    : `<p class="empty">Keine angekündigten Folgen.</p>`;
  html += `</section>`;
  if (waiting.length) html += `<details class="more-box"><summary>${waiting.length} Serien ohne angekündigten Termin</summary><div class="toplist" role="list">${
    waiting.map(x => row(x.base, x.f.last ? `Zuletzt ${epLabel(x.f.last)}` : "Noch keine Folgen", chipFor(x.f))).join("")}</div></details>`;
  if (ended.length) html += `<details class="more-box"><summary>${ended.length} beendete Serien</summary><div class="toplist" role="list">${
    ended.map(x => row(x.base, "Beendet", chipFor(x.f))).join("")}</div></details>`;
  box.innerHTML = html;
  $("k-status").textContent = `${rows.length} ${rows.length === 1 ? "Serie" : "Serien"} · ${upcoming.length} mit neuem Termin`;
  $("k-ics").disabled = !upcoming.length;
  decorate(box);
}
$("k-lists").addEventListener("change", () => { S.calLists = $("k-lists").checked; save("calLists"); renderCalendar() });
$("k-ics").addEventListener("click", () => {
  if (!last.length) return;
  const events = last.map(x => ({uid: `tv${x.f.id}s${x.info.next.s}e${x.info.next.e}`, date: x.date, title: `${x.f.title}: ${epLabel(x.info.next)}`,
    desc: [chipFor(x.f).text, location.origin + location.pathname + `#t-tv-${x.f.id}`].filter(Boolean).join("\n")}));
  download("streamfinder-folgen.ics", buildICS(events), "text/calendar");
  toast("Kalender-Datei heruntergeladen. Öffne sie, um die Termine zu übernehmen.");
});
register("kalender", renderCalendar);
on("follow", () => { if (current() === "kalender") renderCalendar() });
