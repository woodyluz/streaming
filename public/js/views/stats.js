// Statistik: Überblick, Verlauf, Genres, Personen und „Welcher Dienst lohnt sich?“
import { S, P, changed, on } from "../state.js";
import { IMG } from "../constants.js";
import { $, esc, pool, debounce } from "../util.js";
import { titleFull, regions } from "../api.js";
import { listItems, followedSeries, providerList, MINE_NAMES } from "../data.js";
import { overview, byMonth, topGenres, topPeople, serviceValue, verdict, yearReview } from "../stats.js";
import { register, current } from "../router.js";

const MAX = 150;
let lastSV = null;

async function renderStats(){
  const pd = P();
  const watched = Object.values(pd.watched).filter(w => w.type).sort((a, b) => b.t - a.t);
  const recent = watched.slice(0, MAX);
  $("st-status").textContent = "Werte aus …";
  const need = new Map();
  for (const w of recent) need.set(w.key, w);
  for (const k of Object.keys(pd.progress)) if (k.startsWith("tv:")) need.set(k, {key: k, type: "tv", id: +k.split(":")[1]});
  const full = new Map();
  await pool([...need.values()], 4, async w => { try { full.set(w.key, await titleFull(w.type, w.id)) } catch(e){} });
  if (!MINE_NAMES.size) await providerList().catch(() => {});
  // Dienste: alle Titel aus Listen und verfolgten Serien
  const items = [...new Map([...listItems(), ...followedSeries(false)].map(i => [i.key, i])).values()];
  const reg = await regions(items.map(i => ({type: i.type, id: i.id}))).catch(() => new Map());
  if (current() !== "statistik") return;
  const o = overview(recent, full, pd.progress);
  const months = byMonth(watched);
  const genres = topGenres(recent, full);
  const people = topPeople(recent, full);
  const sv = serviceValue(items, reg, S.mine, S.prices);
  for (const r of sv.rows) r.name = r.name || MINE_NAMES.get(r.id) || "Dienst";
  lastSV = sv;
  $("st-status").textContent = watched.length > MAX ? `Ausgewertet: deine letzten ${MAX} gesehenen Titel` : "";

  const maxM = Math.max(1, ...months.map(m => m.count)), maxG = Math.max(1, ...genres.map(g => g.count));
  const tile = (n, t) => `<div class="tile"><b>${n.toLocaleString("de-CH")}</b><span>${t}</span></div>`;
  const years = [...new Set(watched.map(w => new Date(w.t).getFullYear()))].sort((a, b) => b - a);
  const y = recapYear ?? (years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[0]);
  const rv = yearReview(watched, full, y);
  let recap = "";
  if (rv){
    const facts = [rv.genres[0] ? `Dein Genre: <b>${esc(rv.genres[0].name)}</b>${rv.genres[1] ? ", danach " + esc(rv.genres[1].name) : ""}` : "",
      rv.best ? `Dein Höhepunkt: <b>${esc(rv.best.title)}</b>${rv.best.stars ? " (" + "★".repeat(rv.best.stars) + ")" : ""}` : "",
      rv.person ? `Am häufigsten gesehen: <b>${esc(rv.person.name)}</b> (${rv.person.count}×)` : "",
      `Stärkster Monat: <b>${rv.topMonth}</b> mit ${rv.topMonthCount} ${rv.topMonthCount === 1 ? "Titel" : "Titeln"}`,
      `Angefangen mit „${esc(rv.first.title)}“, zuletzt „${esc(rv.last.title)}“`,
      rv.avgStars ? `Im Schnitt vergibst du ${String(rv.avgStars).replace(".", ",")} Sterne` : ""].filter(Boolean);
    recap = `<section class="recap" aria-labelledby="recap-h"><h2 id="recap-h">Dein Filmjahr ${y}</h2><p>Profil „${esc((S.profiles.find(p => p.id === S.profile) || {}).name || "")}“${years.length > 1 ? ` · <label class="vh" for="recap-year">Jahr</label><select id="recap-year" style="padding:3px 6px">${years.map(v => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("")}</select>` : ""}</p>
      <div class="tiles">${tile(rv.count, "Titel gesehen")}${tile(rv.movies, "Filme")}${tile(rv.series, "Serien")}${tile(rv.hours, "Stunden, geschätzt")}</div>
      <ul>${facts.map(f => `<li>${f}</li>`).join("")}</ul></section>`;
  }
  let html = recap + `<h2 class="sec">Dein Überblick</h2><p class="sub">Profil „${esc((S.profiles.find(p => p.id === S.profile) || {}).name || "")}“</p>
    <div class="tiles">${tile(o.movies, "Filme gesehen")}${tile(o.series, "Serien gesehen oder angefangen")}${tile(o.episodes, "Folgen gesehen")}${tile(o.hours, "Stunden vor dem Bildschirm, geschätzt")}</div>`;
  html += `<h2 class="sec">Gesehen pro Monat</h2><p class="sub">Die letzten zwölf Monate, nach dem Tag, an dem du „Gesehen“ markiert hast</p>
    <div class="months" role="img" aria-label="${esc(months.map(m => `${m.label}: ${m.count}`).join(", "))}">${months.map(m => `<div class="month"><em>${m.count || ""}</em><i style="height:${Math.round(m.count / maxM * 100)}%"></i></div>`).join("")}</div>
    <div class="mlabels" aria-hidden="true">${months.map(m => `<span>${m.label}</span>`).join("")}</div>`;
  if (genres.length) html += `<h2 class="sec">Deine Genres</h2><p class="sub">Dunkel: davon „Gefällt mir“</p><div class="hbars">${genres.map(g => `
    <div class="hbar"><span>${esc(g.name)}</span><span class="track" role="img" aria-label="${g.count} gesehen, ${g.liked} gefallen"><span class="fill soft" style="display:block;width:${g.count / maxG * 100}%;position:relative"><span class="fill" style="display:block;position:absolute;left:0;top:0;width:${g.count ? g.liked / g.count * 100 : 0}%"></span></span></span><b>${g.count}</b></div>`).join("")}</div>`;
  if (people.length) html += `<h2 class="sec">Begegnen dir oft</h2><p class="sub">Regie und Besetzung, die in mehreren deiner Titel vorkommen</p>
    <div class="people">${people.map(p => `<a class="person" href="#p-${p.id}"><i aria-hidden="true"></i>${esc(p.name)}<small>${p.count}× · ${esc(p.role)}</small></a>`).join("")}</div>`;
  html += `<h2 class="sec">Welcher Dienst lohnt sich?</h2><p class="sub">${sv.total} Titel aus deinen Listen und verfolgten Serien, verglichen mit deinen Abos. Trag den Monatspreis ein, dann siehst du die Kosten pro Titel.</p>`;
  html += S.mine.length ? `<p class="verdict">${esc(verdict(sv))}</p><div class="tablewrap"><table class="svc"><thead><tr><th scope="col">Dienst</th><th scope="col">Titel für dich</th><th scope="col">Nur dort</th><th scope="col">CHF pro Monat</th><th scope="col">Pro Titel</th></tr></thead><tbody>${
    sv.rows.map(r => `<tr><td>${r.logo ? `<img src="${IMG}w92${r.logo}" alt="">` : ""}${esc(r.name)}</td><td>${r.count}</td><td>${r.exclusive}</td>
      <td><label class="vh" for="price-${r.id}">Monatspreis ${esc(r.name)} in CHF</label><input id="price-${r.id}" data-price="${r.id}" type="number" min="0" step="0.5" inputmode="decimal" value="${r.price || ""}" placeholder="–"></td>
      <td data-per="${r.id}">${r.perTitle ? r.perTitle.toFixed(2) : "–"}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="hint">Wähle in den <a href="#einstellungen">Einstellungen</a> deine Dienste, dann vergleiche ich sie hier.</p>`;
  if (sv.others.length) html += `<h3 class="label" style="margin-top:18px">Nicht abonniert, aber mit deinen Titeln</h3><div class="hbars">${sv.others.map(r => `
    <div class="hbar"><span>${esc(r.name)}</span><span class="track"><span class="fill soft" style="display:block;width:${r.count / Math.max(1, sv.total) * 100}%"></span></span><b>${r.count}</b></div>`).join("")}</div>`;
  if (!watched.length) html = `<p class="hint">Markiere Titel in den Details als „Gesehen“, dann füllt sich deine Statistik.</p>` + html;
  $("st-box").innerHTML = html;
}
const savePrices = debounce(() => changed("prices"), 600);
let recapYear = null;
$("st-box").addEventListener("change", e => { if (e.target.id === "recap-year"){ recapYear = +e.target.value; renderStats() } });
$("st-box").addEventListener("input", e => {
  const inp = e.target.closest("[data-price]"); if (!inp) return;
  const id = inp.dataset.price, v = parseFloat(inp.value.replace(",", "."));
  if (v > 0) S.prices[id] = v; else delete S.prices[id];
  savePrices();
  const r = lastSV?.rows.find(x => String(x.id) === id), cell = $("st-box").querySelector(`[data-per="${id}"]`);
  if (r && cell) cell.textContent = v > 0 && r.count ? (v / r.count).toFixed(2) : "–";
});
register("statistik", renderStats);
on("profile", () => { if (current() === "statistik") renderStats() });
