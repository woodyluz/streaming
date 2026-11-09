// Planer: Abo-Planer (welcher Dienst wann) und Reise-Modus (was läuft am Reiseziel)
import { S, save, changed, on } from "../state.js";
import { COUNTRIES, IMG } from "../constants.js";
import { $, esc, pool, debounce } from "../util.js";
import { regions, saReady, saShow } from "../api.js";
import { listItems, followedSeries, providerList, MINE_NAMES, flatOf, statusOf } from "../data.js";
import { cardHTML, decorate } from "../cards.js";
import { planSubscriptions } from "../plan.js";
import { register, current } from "../router.js";

let sub = "abos";
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const monthName = ym => { const [y, m] = ym.split("-").map(Number); return MONTHS[m - 1] + (y !== new Date().getFullYear() ? " " + y : "") };
const chf = v => v ? "CHF " + v.toFixed(2).replace(/\.00$/, ".–") : "";
const allItems = () => [...new Map([...listItems(), ...followedSeries(false)].map(i => [i.key, i])).values()];

for (const b of document.querySelectorAll("#v-planer [data-sub]")) b.addEventListener("click", () => { sub = b.dataset.sub; render() });

async function render(){
  for (const b of document.querySelectorAll("#v-planer [data-sub]")) b.setAttribute("aria-pressed", b.dataset.sub === sub);
  $("pl-abos").hidden = sub !== "abos"; $("pl-reise").hidden = sub !== "reise";
  return sub === "abos" ? renderAbos() : renderReise();
}

/* ---------- Abo-Planer ---------- */
// Ablaufdaten nur aus dem Zwischenspeicher oder für wenige Titel, um das Kontingent zu schonen
async function expiryFor(items){
  const out = new Map();
  if (!saReady()) return out;
  await pool(items.slice(0, 15), 3, async it => {
    try {
      const sh = await saShow(it.type, it.id);
      for (const o of (sh.streamingOptions || {})[S.country.toLowerCase()] || []){
        if (o.type !== "subscription" || !o.expiresOn) continue;
        for (const [id, name] of MINE_NAMES) if (name && o.service?.name && name.toLowerCase().replace(/\s/g, "") === o.service.name.toLowerCase().replace(/\s/g, "")) out.set(it.key + "|" + id, o.expiresOn);
      }
    } catch(e){}
  });
  return out;
}
let seq = 0;
async function renderAbos(){
  const my = ++seq;
  const items = allItems();
  const box = $("pl-box");
  if (!items.length){ $("pl-status").textContent = ""; box.innerHTML = `<p class="hint">Setz zuerst Titel auf deine Listen oder folge Serien. Daraus plane ich deine Abos.</p>`; return }
  $("pl-status").textContent = `Prüfe ${items.length} Titel …`;
  if (!MINE_NAMES.size) await providerList().catch(() => {});
  const reg = await regions(items.map(i => ({type: i.type, id: i.id}))).catch(() => new Map());
  const expiry = await expiryFor(items);
  if (my !== seq || current() !== "planer") return;
  let r = reg;
  if (!$("pl-all").checked){
    r = new Map([...reg].map(([k, v]) => [k, v && {...v, flatrate: (v.flatrate || []).filter(p => S.mine.includes(p.provider_id)), ads: (v.ads || []).filter(p => S.mine.includes(p.provider_id))}]));
  }
  const plan = planSubscriptions({items, regions: r, mine: S.mine, prices: S.prices, perMonth: +$("pl-per").value || 8, months: +$("pl-months").value || 4, expiry});
  // Preise für Dienste im Plan abfragen, die noch keinen haben
  const svcIds = [...new Set([...plan.months.map(m => m.service), ...S.mine])];
  let html = "";
  if (plan.costNow && plan.costPlan && !plan.unpriced){
    const save_ = plan.costNow - plan.costPlan;
    html += `<div class="tiles"><div class="tile"><b>${chf(plan.costPlan)}</b><span>mit diesem Plan für ${plan.months.length} Monate</span></div>
      <div class="tile"><b>${chf(plan.costNow)}</b><span>mit deinen jetzigen Abos</span></div>
      <div class="tile"><b class="savings">${save_ > 0 ? chf(save_) : "–"}</b><span>${save_ > 0 ? "gespart" : "kein Sparpotenzial"}</span></div></div>`;
  }
  html += `<div class="panelbox" style="max-width:860px"><h2>Monatspreise</h2><p>Trag ein, was die Dienste dich kosten. Damit rechnet der Planer pro Franken.</p><div class="row">${svcIds.map(id => {
    const name = MINE_NAMES.get(id) || plan.months.find(m => m.service === id)?.name || "Dienst";
    return `<label class="cc"><span>${esc(name)}</span><input type="number" min="0" step="0.5" inputmode="decimal" data-price="${id}" value="${S.prices[id] || ""}" placeholder="CHF" aria-label="Monatspreis ${esc(name)} in CHF" style="width:76px;padding:5px 7px"></label>`;
  }).join("")}</div></div>`;
  if (plan.free.length) html += `<section class="section"><h2 class="sec">Gratis verfügbar</h2><p class="sub">Laufen kostenlos, z. B. bei ${esc([...new Set(plan.free.flatMap(f => f.services))].slice(0, 3).join(", "))}. Dafür brauchst du kein Abo.</p>
    <div class="rail" id="pl-free">${plan.free.map(f => cardHTML({media_type: f.type, id: f.id, title: f.title, poster_path: f.poster, year: f.year, orig: f.orig}, {chip: {kind: "mine", text: f.services[0]}})).join("")}</div></section>`;
  html += plan.months.length ? `<section class="section"><h2 class="sec">Dein Plan</h2>${plan.months.map((m, i) => `
    <div class="month-plan"><h3>${monthName(m.month)}</h3>
      <div><div class="svcname">${m.logo ? `<img src="${IMG}w92${m.logo}" alt="">` : ""}${esc(m.name)}${m.mine ? `<span class="tag good">hast du</span>` : `<span class="tag">abschliessen</span>`}${m.price ? `<span class="tag">${chf(m.price)}</span>` : ""}</div>
      <p class="sub" style="margin:4px 0 0">${m.titles.length} Titel zum Schauen${m.titles.some(t => t.soon) ? `, davon ${m.titles.filter(t => t.soon).length} nur noch diesen Monat` : ""}${m.more ? `, ${m.more} weitere dort` : ""}.
      ${i + 1 < plan.months.length && plan.months[i + 1].service !== m.service ? "Danach kündigen." : ""}</p></div>
      <div class="rail">${m.titles.map(t => cardHTML({media_type: t.type, id: t.id, title: t.title, poster_path: t.poster, year: t.year, orig: t.orig}, {chip: t.soon ? {kind: "pay", text: "läuft aus"} : {kind: "mine", text: m.name}})).join("")}</div>
    </div>`).join("")}</section>` : `<p class="hint">Keiner deiner Titel läuft gerade im Abo. Schau im Reiter „Neu &amp; bald“, was bald kommt.</p>`;
  if (plan.cancel.length) html += `<section class="section"><h2 class="sec">Kündigen?</h2><p class="sub">Diese Abos kommen im Plan nicht vor.</p><ul>${plan.cancel.map(c =>
    `<li><b>${esc(c.name || MINE_NAMES.get(c.id) || "Dienst")}</b>: ${c.count ? `${c.count} Titel aus deinen Listen, die es auch anderswo gibt oder später drankommen` : "kein Titel aus deinen Listen"}${c.price ? `, ${chf(c.price)} im Monat` : ""}</li>`).join("")}</ul></section>`;
  if (plan.notStreaming) html += `<p class="sub">${plan.notStreaming} Titel laufen gerade in keinem Abo und sind nicht eingeplant.</p>`;
  box.innerHTML = html;
  $("pl-status").textContent = plan.unpriced ? "Tipp: Mit Monatspreisen wird der Plan genauer." : "";
  for (const el of box.querySelectorAll(".rail")) decorate(el);
}
const savePrices = debounce(() => { changed("prices"); if (current() === "planer") renderAbos() }, 900);
$("pl-box").addEventListener("input", e => {
  const inp = e.target.closest("[data-price]"); if (!inp) return;
  const v = parseFloat(inp.value.replace(",", "."));
  if (v > 0) S.prices[inp.dataset.price] = v; else delete S.prices[inp.dataset.price];
  savePrices();
});
for (const id of ["pl-per", "pl-months", "pl-all"]) $(id).addEventListener("change", renderAbos);

/* ---------- Reise-Modus ---------- */
for (const [c, n] of Object.entries(COUNTRIES)) $("rs-country").add(new Option(n, c));
$("rs-country").value = S.meta.__travel || (S.country === "DE" ? "IT" : "DE");
async function renderReise(){
  const my = ++seq, cc = $("rs-country").value, items = allItems();
  S.meta.__travel = cc; save("meta");
  const box = $("rs-box");
  if (!items.length){ box.innerHTML = `<p class="hint">Setz zuerst Titel auf deine Listen.</p>`; $("rs-status").textContent = ""; return }
  $("rs-status").textContent = `Prüfe ${items.length} Titel in ${COUNTRIES[cc]} …`;
  const [there, home] = await Promise.all([regions(items.map(i => ({type: i.type, id: i.id})), cc).catch(() => new Map()),
    regions(items.map(i => ({type: i.type, id: i.id}))).catch(() => new Map())]);
  if (my !== seq || current() !== "planer") return;
  const onlyMine = $("rs-mine").checked;
  const rows = [];
  for (const it of items){
    const f = flatOf(there.get(it.key)), mine = f.filter(p => S.mine.includes(p.provider_id));
    const use = onlyMine ? mine : f;
    if (!use.length) continue;
    const homeMine = statusOf(home.get(it.key)).kind === "mine";
    rows.push({it, names: [...new Set(use.map(p => p.provider_name))], extra: !homeMine});
  }
  rows.sort((a, b) => b.extra - a.extra);
  const extra = rows.filter(r => r.extra).length;
  $("rs-status").textContent = rows.length ? `${rows.length} deiner Titel laufen in ${COUNTRIES[cc]}${onlyMine ? " in deinen Diensten" : ""}, ${extra} davon zu Hause nicht.` : `In ${COUNTRIES[cc]} läuft nichts aus deinen Listen${onlyMine ? " in deinen Diensten" : ""}.`;
  box.innerHTML = rows.length ? `<div class="grid">${rows.map(r => cardHTML({media_type: r.it.type, id: r.it.id, title: r.it.title, poster_path: r.it.poster, year: r.it.year, orig: r.it.orig},
    {chip: {kind: r.extra ? "soon" : "mine", text: (r.extra ? "Nur dort: " : "") + r.names.slice(0, 2).join(", ")}})).join("")}</div>` : "";
}
for (const id of ["rs-country", "rs-mine"]) $(id).addEventListener("change", renderReise);

register("planer", render);
on("synced", () => { if (current() === "planer") render() });
