// Detailansicht als Seitenblatt
import { S, P, save, profile } from "../state.js";
import { COUNTRIES, GROUPS, IMG, LANGS } from "../constants.js";
import { $, esc, fmtDate, num, yearOf, normName, toast, copy, debounce } from "../util.js";
import { titleFull, omdb, omReady, saReady, saShow, nowPlaying } from "../api.js";
import { MINE_NAMES, providerList, remember, listCount, isFollowed, setFollow, setWatched, setStars, setNote, setProgress, flatOf, origOf, isPriceWatched, setPriceWatch } from "../data.js";
import { cardHTML, personHTML, decorate, fskLimit } from "../cards.js";
import { posterHTML } from "../posters.js";
import { openModal, closeModal, isOpen, keepFocus } from "../a11y.js";
import { current } from "../router.js";

let fromHash = false, curF = null;

export async function openDetail(type, id, viaHash){
  const panel = $("panel"), key = type + ":" + id;
  fromHash = !!viaHash;
  if (!viaHash && location.hash.startsWith("#t-")) history.replaceState(null, "", location.pathname + "#" + (current() || "entdecken"));
  panel.innerHTML = `<button class="close" type="button" data-close>Schliessen</button><p class="status" id="d-title">Lade …</p>`;
  if (!isOpen($("sheet"))) openModal($("sheet"), {focus: () => panel.querySelector("[data-close]"), onClose: afterClose});
  if (S.track[key]?.n){ S.track[key].n = false; save("track"); document.querySelectorAll(`.card[data-key="${key}"] .new`).forEach(n => n.remove()) }
  try {
    const f = await titleFull(type, id);
    remember(f);
    curF = f;
    draw(f, true);
  } catch(e){
    panel.innerHTML = `<button class="close" type="button" data-close>Schliessen</button><p class="status" id="d-title">${esc(e.message)}</p>`;
  }
}
function afterClose(){
  curF = null;
  if (fromHash) history.replaceState(null, "", location.pathname + "#" + (current() || "entdecken"));
  fromHash = false;
}
export function closeDetail(){ if (isOpen($("sheet"))) closeModal($("sheet")) }

const langName = c => LANGS[c] || c;
function saHTML(show){
  const opts = (show.streamingOptions || {})[S.country.toLowerCase()] || [];
  if (!opts.length) return `<p class="empty">Keine direkten Links für ${COUNTRIES[S.country]} gefunden.</p>`;
  const ORDER = ["subscription", "free", "addon", "rent", "buy"], TYPES = {subscription: "Im Abo", free: "Kostenlos", addon: "Zusatzkanal", rent: "Leihen", buy: "Kaufen"};
  const best = new Map();
  for (const o of opts){
    const k = (o.service?.id || o.service?.name) + ":" + o.type + ":" + (o.addon?.id || "");
    const prev = best.get(k);
    if (!prev || (+o.price?.amount || 0) < (+prev.price?.amount || 0)) best.set(k, o);
  }
  return `<div class="salist">${[...best.values()].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)).map(o => {
    const img = o.service?.imageSet || {};
    const logo = img.lightThemeImage ? `<picture>${img.darkThemeImage ? `<source srcset="${esc(img.darkThemeImage)}" media="(prefers-color-scheme: dark)">` : ""}<img src="${esc(img.lightThemeImage)}" alt=""></picture>` : "";
    const mine = S.mine.some(id => normName(MINE_NAMES.get(id)) === normName(o.service?.name));
    const auds = [...new Set((o.audios || []).map(a => a.language))].map(langName);
    const subs = [...new Set((o.subtitles || []).map(s => s.locale?.language))].filter(Boolean).map(langName);
    const bits = [TYPES[o.type] || o.type, o.addon?.name, o.price?.formatted, o.quality?.toUpperCase()].filter(Boolean).join(" · ");
    const lang = [auds.length ? "Ton: " + auds.slice(0, 4).join(", ") : "", subs.length ? "UT: " + subs.slice(0, 4).join(", ") : ""].filter(Boolean).join(" · ");
    const exp = o.expiresOn ? `<span class="exp${o.expiresSoon ? " soon" : ""}">bis ${fmtDate(o.expiresOn, true)}</span>` : "";
    return `<a class="sa${mine ? " mine" : ""}" href="${esc(o.link)}" target="_blank" rel="noopener">
      ${logo}<span class="sa-t"><b>${esc(o.service?.name || "Anbieter")}${mine ? " · dein Dienst" : ""}</b><small>${esc(bits)}</small>${lang ? `<small>${esc(lang)}</small>` : ""}</span>${exp}<span class="go" aria-hidden="true">Öffnen</span></a>`;
  }).join("")}</div>`;
}

function extras(f){
  const type = f.media_type, id = f.id;
  if (omReady() && f.imdb) omdb(f.imdb).then(o => {
    const box = $("scores"); if (!box || !o || o.Response === "False" || box.querySelector("[data-om]")) return;
    const tag = {"Internet Movie Database": "IMDb", "Rotten Tomatoes": "Rotten Tomatoes", "Metacritic": "Metacritic"};
    box.insertAdjacentHTML("beforeend", (o.Ratings || []).map(r => r.Source === "Internet Movie Database"
      ? `<a class="score" data-om href="https://www.imdb.com/title/${esc(f.imdb)}/" target="_blank" rel="noopener">IMDb ${esc(r.Value.replace("/10", "").replace(".", ","))}</a>`
      : `<span class="score" data-om>${esc(tag[r.Source] || r.Source)} ${esc(r.Value)}</span>`).join(""));
  }).catch(() => {});
  if (saReady()){
    if (!MINE_NAMES.size) providerList().catch(() => {});
    saShow(type, id).then(show => { const b = $("sa-box"); if (b) b.innerHTML = `<h3 class="dlabel">Direkt ansehen</h3>` + saHTML(show) })
      .catch(err => { const b = $("sa-box"); if (!b) return; if (err.message === "off") b.remove(); else b.querySelector(".empty").textContent = err.message });
  }
  if ($("sim-rail")) decorate($("sim-rail"));
  if (type === "movie") nowPlaying().then(list => {
    if (!list.some(m => m.id === +id) || !$("panel").querySelector(".actions") || $("panel").querySelector("[data-kino]")) return;
    const q = encodeURIComponent(`${f.title} Kino ${S.city || ""} Vorstellungen`.trim());
    $("panel").querySelector(".actions").insertAdjacentHTML("beforeend", `<a data-kino href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Im Kino: Vorstellungen${S.city ? " in " + esc(S.city) : ""}</a>`);
  }).catch(() => {});
  const note = $("d-note");
  if (note) note.addEventListener("input", debounce(() => setNote(type + ":" + id, note.value), 600));
}

function draw(f, first){
  const panel = $("panel");
  const render = () => { panel.innerHTML = html(f); bindProgress(f) };
  if (first){ render(); panel.querySelector("[data-close]").focus(); panel.scrollTop = 0 }
  else {
    const inside = panel.contains(document.activeElement);
    if (!keepFocus(panel, render) && inside) panel.querySelector("[data-close]").focus();
  }
  extras(f);
}

function html(f){
  const type = f.media_type, key = type + ":" + f.id, pd = P();
  const all = f.providers || {}, r = all[S.country];
  const groups = r ? GROUPS.filter(([g]) => r[g]?.length).map(([g, label]) => `
    <div class="group"><p class="label">${label}</p><div class="providers">
    ${[...r[g]].sort((a, b) => a.display_priority - b.display_priority).map(p => `
      <a class="prov${S.mine.includes(p.provider_id) ? " mine" : ""}" href="${esc(r.link)}" target="_blank" rel="noopener">
        <img src="${IMG}w92${p.logo_path}" alt="">${esc(p.provider_name)}${S.mine.includes(p.provider_id) ? " · dein Dienst" : ""}</a>`).join("")}
    </div></div>`).join("") : "";
  const trailer = f.videos.find(v => v.type === "Trailer" && v.lang === "de") || f.videos.find(v => v.type === "Trailer") || f.videos[0];
  const ert = (f.episode_run_time || [])[0];
  const runtime = f.runtime ? f.runtime + " Min." : f.number_of_seasons ? f.number_of_seasons + (f.number_of_seasons > 1 ? " Staffeln" : " Staffel") + (ert ? ` · ${ert} Min. pro Folge` : "") : "";
  const cmp = S.compare.filter(c => c !== S.country).map(c => {
    const x = all[c], uniq = [...new Map(flatOf(x).map(p => [p.provider_id, p])).values()];
    const cell = uniq.length ? uniq.slice(0, 6).map(p => `<img src="${IMG}w92${p.logo_path}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join("")
      : x && ((x.rent || []).length || (x.buy || []).length) ? "Leihen oder kaufen" : "Nicht verfügbar";
    return `<tr><th scope="row">${COUNTRIES[c]}</th><td>${cell}</td></tr>`;
  }).join("");
  const nLists = listCount(key), w = pd.watched[key], followed = isFollowed(key);
  const byJob = jobs => [...new Map(f.crew.filter(p => jobs.includes(p.job)).map(p => [p.id, p])).values()];
  const people = (label, list) => list.length ? `<div><span class="empty">${label}:</span> ${list.slice(0, 3).map(p => `<a href="#p-${p.id}">${esc(p.name)}</a>`).join(", ")}</div>` : "";
  const credits = [people(type === "tv" ? "Idee" : "Regie", type === "tv" ? f.created_by : byJob(["Director"])),
    people("Drehbuch", byJob(["Screenplay", "Writer", "Teleplay"])), people("Vorlage", byJob(["Novel", "Author", "Original Story", "Story", "Characters"]))].join("");
  const {limit} = fskLimit("");
  const tooOld = limit !== null && f.fsk !== null && f.fsk > limit;
  let prog = "";
  if (type === "tv" && f.seasons.length){
    const pr = pd.progress[key];
    const curS = f.seasons.find(s => s.n === (pr?.s || f.seasons[0].n)) || f.seasons[0];
    const total = f.seasons.reduce((a, s) => a + s.c, 0);
    const done = pr ? f.seasons.filter(s => s.n < pr.s).reduce((a, s) => a + s.c, 0) + pr.e : 0;
    prog = `<div class="progress"><p><b>Dein Stand:</b> ${pr && pr.e ? `Staffel ${pr.s}, Folge ${pr.e} gesehen · ${done} von ${total} Folgen` : pr ? `Staffel ${pr.s}: noch keine Folge gesehen` : "Noch nicht angefangen"}${
      f.next?.date ? ` · Nächste neue Folge: ${fmtDate(f.next.date, true)}` : ""}</p>
      <div class="row"><label class="vh" for="pg-s">Staffel</label><select id="pg-s">${f.seasons.map(s => `<option value="${s.n}" ${pr && pr.s === s.n ? "selected" : ""}>Staffel ${s.n}</option>`).join("")}</select>
      <label class="vh" for="pg-e">Zuletzt gesehene Folge</label><select id="pg-e"><option value="0">–</option>${Array.from({length: curS.c}, (_, i) => `<option value="${i + 1}" ${pr && pr.s === curS.n && pr.e === i + 1 ? "selected" : ""}>Folge ${i + 1}</option>`).join("")}</select>
      <button type="button" class="primary" id="pg-next">Nächste Folge gesehen</button></div></div>`;
  }
  return `
    <button class="close" type="button" data-close>Schliessen</button>
    <div class="head">
      ${posterHTML(f.poster_path, {title: f.title, key})}
      <div><h2 id="d-title">${esc(f.title)}</h2>${origOf(f) ? `<p><i>${esc(origOf(f))}</i></p>` : ""}
        <p>${[type === "tv" ? "Serie" : "Film", yearOf(f), runtime].filter(Boolean).join(" · ")}</p>
        <p>${f.genres.map(g => g.name).slice(0, 3).join(", ")}</p>
        <div class="scores" id="scores">${f.fsk !== null ? `<span class="score fsk">FSK ${f.fsk}</span>` : ""}${f.vote_average ? `<span class="score">TMDB ${num(f.vote_average)}</span>` : ""}</div>
      </div>
    </div>
    ${tooOld ? `<p class="hint">Dieser Titel ist ab ${f.fsk} und liegt über der Altersgrenze des Profils „${esc(S.profiles.find(p => p.id === S.profile)?.name || "")}“.</p>` : ""}
    <div class="actions">
      <button type="button" class="${nLists ? "" : "primary"}" data-pick="${key}" data-fk="pick">${nLists ? (nLists > 1 ? `In ${nLists} Listen` : "Gemerkt") : "Merken"}</button>
      <button type="button" aria-pressed="${!!w}" data-act="seen" data-fk="seen">Gesehen</button>

      ${type === "tv" ? `<button type="button" aria-pressed="${followed}" data-act="follow" data-fk="follow">${followed ? "Folge ich" : "Folgen"}</button>` : ""}
      ${trailer ? `<a href="https://www.youtube.com/watch?v=${esc(trailer.key)}" target="_blank" rel="noopener">Trailer</a>` : ""}
      ${saReady() ? `<button type="button" aria-pressed="${isPriceWatched(key)}" data-act="pwatch" data-fk="pwatch">${isPriceWatched(key) ? "Preis wird beobachtet" : "Preis beobachten"}</button>` : ""}
      <button type="button" data-act="share" data-fk="share">Teilen</button>
    </div>
    ${w ? `<div class="rate"><p><b>Deine Bewertung</b> · gesehen ${fmtDate(w.t, true)}</p>
      <div class="stars" role="group" aria-label="Sterne vergeben">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${(w.stars || 0) >= n ? "on" : ""}" data-act="star" data-v="${n}" data-fk="star${n}" aria-pressed="${w.stars === n}" aria-label="${n} von 5 Sternen">★</button>`).join("")}</div>
      <label class="vh" for="d-note">Notiz</label><textarea id="d-note" class="note" maxlength="500" placeholder="Notiz für dich, z. B. mit wem du ihn geschaut hast">${esc(w.note || "")}</textarea></div>` : ""}
    ${prog}
    ${f.overview ? `<p class="overview">${esc(f.overview)}</p>` : ""}
    ${credits ? `<div class="credits">${credits}</div>` : ""}
    ${f.cast.length ? `<h3 class="dlabel">Besetzung</h3><div class="people">${f.cast.map(p => personHTML({...p, sub: p.character})).join("")}</div>` : ""}
    <h3 class="dlabel">Verfügbar in ${COUNTRIES[S.country]}</h3>
    ${groups || `<p class="empty">Derzeit bei keinem Anbieter in ${COUNTRIES[S.country]} verfügbar.</p>`}
    ${r?.link ? `<p style="font-size:13px;margin:0"><a href="${esc(r.link)}" target="_blank" rel="noopener">Alle Angebote ansehen</a></p>` : ""}
    ${saReady() ? `<div id="sa-box"><h3 class="dlabel">Direkt ansehen</h3><p class="empty">Lade direkte Links …</p></div>` : ""}
    ${cmp ? `<h3 class="dlabel">Andere Länder (Abo)</h3><table class="compare"><tbody>${cmp}</tbody></table>` : ""}
    ${f.recs.length ? `<h3 class="dlabel">Ähnliche Titel</h3><div class="rail" id="sim-rail">${f.recs.map(x => cardHTML(x)).join("")}</div>` : ""}`;
}

function bindProgress(f){
  if (!$("pg-s")) return;
  const key = "tv:" + f.id;
  $("pg-s").onchange = () => { setProgress(key, {s: +$("pg-s").value, e: 0}); draw(f) };
  $("pg-e").onchange = () => { const e = +$("pg-e").value; setProgress(key, e ? {s: +$("pg-s").value, e} : null); draw(f) };
  $("pg-next").onclick = () => {
    const pr = {...(P().progress[key] || {s: f.seasons[0].n, e: 0})};
    const si = f.seasons.findIndex(s => s.n === pr.s), cs = f.seasons[Math.max(0, si)];
    if (pr.e < cs.c) pr.e++;
    else if (si + 1 < f.seasons.length){ pr.s = f.seasons[si + 1].n; pr.e = 1 }
    setProgress(key, pr);
    const lastS = f.seasons[f.seasons.length - 1];
    if (pr.s === lastS.n && pr.e === lastS.c && !P().watched[key]){ setWatched(key, true); toast("Alle Folgen gesehen") }
    draw(f);
  };
}

$("sheet").addEventListener("click", async e => {
  if (e.target.id === "sheet" || e.target.closest("[data-close]")) return closeDetail();
  const b = e.target.closest("[data-act]");
  if (!b || !curF) return;
  const key = curF.media_type + ":" + curF.id;
  if (b.dataset.act === "seen"){ const on_ = !P().watched[key]; setWatched(key, on_); toast(on_ ? "Als gesehen markiert" : "Markierung entfernt") }
  if (b.dataset.act === "star") setStars(key, +b.dataset.v);
  if (b.dataset.act === "pwatch"){
    const on_ = !isPriceWatched(key); setPriceWatch(key, on_, {title: curF.title, type: curF.media_type, id: curF.id});
    toast(on_ ? "Du bekommst eine Mitteilung, wenn der Titel günstiger wird oder in deinem Abo landet." : "Preis wird nicht mehr beobachtet");
  }
  if (b.dataset.act === "follow"){ const on_ = !isFollowed(key); setFollow(key, on_); toast(on_ ? "Du folgst der Serie. Neue Folgen erscheinen im Kalender." : "Du folgst der Serie nicht mehr") }
  if (b.dataset.act === "share"){
    const url = location.origin + location.pathname + `#t-${curF.media_type}-${curF.id}`;
    try { if (navigator.share){ await navigator.share({title: curF.title, text: `${curF.title}: wo läuft das?`, url}); return } } catch(err){ if (err.name === "AbortError") return }
    toast(await copy(url) ? "Link kopiert" : url);
    return;
  }
  draw(curF);
});
