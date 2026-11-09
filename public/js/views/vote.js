// Filmabend: Abstimmung erstellen (mit Passwort) und mitmachen (alle mit Link)
import { S, P, profile, store } from "../state.js";
import { IMG, H } from "../constants.js";
import { $, esc, short, toast, copy, pool, titleOf, yearOf } from "../util.js";
import { tmdb, regions, workerApi, certOf } from "../api.js";
import { statusOf, providerList, genreMap } from "../data.js";
import { fskLimit } from "../cards.js";
import { voteResult } from "../vote.js";
import { openModal, closeModal } from "../a11y.js";
import { register, current } from "../router.js";
import { syncReady } from "../sync.js";

/* ---------- Erstellen ---------- */
export function openVoteMaker(preset){
  const sel = $("vmk-src");
  sel.innerHTML = `<option value="pop">Beliebt in unseren Diensten</option><option value="pop-tv">Beliebte Serien in unseren Diensten</option>` +
    P().lists.filter(l => l.items.length >= 2).map(l => `<option value="l:${l.id}">Liste „${esc(l.name)}“ (${l.items.length})</option>`).join("");
  if (preset && [...sel.options].some(o => o.value === preset)) sel.value = preset;
  $("vmk-status").textContent = ""; $("vmk-link").innerHTML = ""; $("vmk-go").hidden = false;
  if (!syncReady()) $("vmk-status").textContent = "Zum Erstellen muss dieses Gerät verbunden sein (Einstellungen → Geräte synchronisieren).";
  openModal($("vmk"), {focus: () => $("vmk-name")});
}
async function candidates(src, n, onlyMine){
  let list = [];
  if (src.startsWith("l:")){
    const l = P().lists.find(x => x.id === src.slice(2));
    list = (l?.items || []).filter(i => !P().watched[i.key]).map(i => ({key: i.key, type: i.type, id: i.id, title: i.title, poster: i.poster, year: i.year}));
    list.sort(() => Math.random() - .5);
  } else {
    const type = src === "pop-tv" ? "tv" : "movie";
    const p = {watch_region: S.country, sort_by: "popularity.desc", "vote_average.gte": 6.5, "vote_count.gte": type === "tv" ? 150 : 300, include_adult: "false",
      with_watch_monetization_types: "flatrate|free|ads", page: 1 + Math.floor(Math.random() * 3)};
    if (onlyMine && S.mine.length) p.with_watch_providers = S.mine.join("|");
    const {limit} = fskLimit("");
    if (type === "movie" && limit !== null){ p.certification_country = "DE"; p["certification.lte"] = limit }
    const d = await tmdb(`/discover/${type}`, p, 6 * H);
    list = d.results.filter(x => !P().watched[type + ":" + x.id]).map(x => ({key: type + ":" + x.id, type, id: x.id, title: titleOf(x), poster: x.poster_path, year: yearOf(x),
      overview: short(x.overview || "", 300), genre_ids: x.genre_ids}));
  }
  const reg = await regions(list.map(i => ({type: i.type, id: i.id}))).catch(() => new Map());
  const out = [];
  const {limit, strict} = fskLimit("");
  for (const it of list){
    if (out.length >= n) break;
    const st = statusOf(reg.get(it.key));
    if (onlyMine && S.mine.length && st.kind !== "mine") continue;
    if (limit !== null){ const c = await certOf(it.type, it.id).catch(() => null); if (c === null ? strict : c > limit) continue }
    out.push({...it, info: st.kind === "mine" || st.kind === "flat" ? st.text : ""});
  }
  // Beschreibungen für Listen-Titel nachladen
  const gm = new Map([...(await genreMap("movie").catch(() => new Map())), ...(await genreMap("tv").catch(() => new Map()))]);
  for (const it of out) if (it.genre_ids && !it.info) it.info = it.genre_ids.slice(0, 2).map(g => gm.get(g)).filter(Boolean).join(", ");
  return out;
}
$("vmk-go").addEventListener("click", async () => {
  if (!syncReady()) return;
  const st = $("vmk-status");
  $("vmk-go").disabled = true; st.textContent = "Stelle Vorschläge zusammen …";
  try {
    if (!S.mine.length) await providerList().catch(() => {});
    const items = await candidates($("vmk-src").value, +$("vmk-n").value, $("vmk-mine").checked);
    if (items.length < 2){ st.textContent = "Zu wenige passende Titel. Wähle eine andere Quelle oder schalte „Nur was in unseren Diensten läuft“ aus."; return }
    const {id} = await workerApi("/api/vote", {method: "POST", body: {title: $("vmk-name").value.trim() || "Filmabend", host: profile().name, items}});
    const url = location.origin + location.pathname + "#abstimmen-" + id;
    st.textContent = `${items.length} Vorschläge bereit. Schick den Link an alle, die mitschauen.`;
    $("vmk-link").innerHTML = `<div class="linkbox"><label class="vh" for="vmk-url">Link zur Abstimmung</label><input id="vmk-url" type="text" readonly value="${esc(url)}">
      <button type="button" class="primary" id="vmk-share">Link teilen</button><a href="#abstimmen-${id}" id="vmk-open">Selbst abstimmen</a></div>`;
    $("vmk-go").hidden = true;
    $("vmk-share").onclick = async () => {
      try { if (navigator.share){ await navigator.share({title: $("vmk-name").value, text: "Stimm mit ab, was wir schauen:", url}); return } } catch(e){ if (e.name === "AbortError") return }
      toast(await copy(url) ? "Link kopiert" : "Link markieren und kopieren");
      $("vmk-url").select();
    };
    $("vmk-open").onclick = () => closeModal($("vmk"));
  } catch(e){ st.textContent = e.message }
  finally { $("vmk-go").disabled = false }
});
$("vmk-close").addEventListener("click", () => closeModal($("vmk")));
$("vmk").addEventListener("click", e => { if (e.target.id === "vmk") closeModal($("vmk")) });
document.addEventListener("click", e => { const b = e.target.closest("[data-vote]"); if (b) openVoteMaker(b.dataset.vote || undefined) });

/* ---------- Mitmachen ---------- */
const V = {id: null, doc: null, me: null, i: 0, timer: null};
const meKey = id => "sf:vote:" + id;
function loadMe(id){
  const m = store.json(meKey(id), null);
  return m || {pid: Array.from(crypto.getRandomValues(new Uint8Array(6)), b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("") + Date.now().toString(36).slice(-4), name: store.json("sf:voteName", "") || "", yes: [], no: [], done: false};
}
const saveMe = () => { store.set(meKey(V.id), JSON.stringify(V.me)); if (V.me.name) store.set("sf:voteName", JSON.stringify(V.me.name)) };
let sendT;
function send(now){
  clearTimeout(sendT);
  const go = () => workerApi(`/api/vote/${V.id}/p/${V.me.pid}`, {method: "PUT", body: V.me, auth: false}).catch(e => toast(e.message));
  if (now) return go();
  sendT = setTimeout(go, 800);
}

async function load(id){
  clearInterval(V.timer);
  if (V.id !== id){ V.id = id; V.me = loadMe(id) }
  const box = $("vt-box");
  box.innerHTML = `<p class="status">Lade Abstimmung …</p>`;
  try { V.doc = await workerApi("/api/vote/" + id, {auth: false}) }
  catch(e){ box.innerHTML = `<p class="hint">${e.code === 404 ? "Diese Abstimmung gibt es nicht mehr. Abstimmungen laufen sieben Tage." : esc(e.message)}</p>`; return }
  if (!V.me.name && !V.doc.closed){ askName(); return }
  next();
}
function askName(){
  $("vt-box").innerHTML = `<h2 class="sec">${esc(V.doc.title)}</h2><p class="sub">${V.doc.host ? esc(V.doc.host) + " lädt dich ein. " : ""}${V.doc.items.length} Vorschläge, wisch nach rechts für „ja“, nach links für „nein“.</p>
    <form class="row" id="vt-name" style="justify-content:center"><label class="vh" for="vt-n">Dein Name</label><input id="vt-n" type="text" maxlength="30" placeholder="Dein Name" required autocomplete="given-name"><button class="primary" type="submit">Los geht’s</button></form>`;
  $("vt-n").focus();
  $("vt-name").onsubmit = e => { e.preventDefault(); V.me.name = $("vt-n").value.trim().slice(0, 30); if (!V.me.name) return; saveMe(); next() };
}
const voted = k => V.me.yes.includes(k) || V.me.no.includes(k);
function next(){
  const left = V.doc.items.filter(i => !voted(i.key));
  if (!left.length || V.doc.closed){
    if (!V.me.done && !V.doc.closed){ V.me.done = true; saveMe(); send(true) }
    return results();
  }
  const it = left[0], pos = V.doc.items.length - left.length + 1;
  $("vt-box").innerHTML = `<p class="vprog">${esc(V.doc.title)} · ${pos} von ${V.doc.items.length}</p>
    <div class="vcard" id="vt-card">
      <span class="poster" aria-hidden="true" style="${it.poster ? `background-image:url(${IMG}w500${it.poster})` : ""}"></span>
      <div class="vbody"><h3>${esc(it.title)}</h3><p>${[it.type === "tv" ? "Serie" : "Film", it.year, it.info].filter(Boolean).map(esc).join(" · ")}</p>
      ${it.overview ? `<p style="margin-top:8px;color:var(--fg)">${esc(it.overview)}</p>` : ""}</div>
    </div>
    <div class="vbtns"><button type="button" class="no" id="vt-no" aria-label="Nein, „${esc(it.title)}“ lieber nicht">✕</button><button type="button" class="yes" id="vt-yes" aria-label="Ja, „${esc(it.title)}“ würde ich schauen">♥</button></div>
    <p class="vprog"><button type="button" id="vt-res" style="border:0;background:none;color:var(--accent);padding:0;text-decoration:underline">Zwischenstand ansehen</button></p>`;
  const vote = yes => { (yes ? V.me.yes : V.me.no).push(it.key); saveMe(); send(); next() };
  $("vt-yes").onclick = () => vote(true); $("vt-no").onclick = () => vote(false); $("vt-res").onclick = results;
  $("vt-yes").focus({preventScroll: true});
  // Wischen
  const c = $("vt-card"); let x0 = null, dx = 0;
  c.addEventListener("pointerdown", e => { x0 = e.clientX; dx = 0; c.setPointerCapture(e.pointerId) });
  c.addEventListener("pointermove", e => { if (x0 === null) return; dx = e.clientX - x0; c.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)` });
  const up = () => { if (x0 === null) return; x0 = null; c.style.transform = ""; if (dx > 90) vote(true); else if (dx < -90) vote(false) };
  c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
}
async function results(){
  clearInterval(V.timer);
  const draw = () => {
    const parts = (V.doc.parts || []).filter(p => p.pid !== V.me.pid).concat(V.me.yes.length + V.me.no.length ? [{...V.me}] : []);
    const r = voteResult(V.doc.items, parts);
    const left = V.doc.items.filter(i => !voted(i.key)).length;
    const names = parts.map(p => p.name + (p.done ? "" : " (noch dabei)")).join(", ");
    let html = `<h2 class="sec">${esc(V.doc.title)}</h2><p class="sub">${r.n} ${r.n === 1 ? "Person hat" : "Personen haben"} abgestimmt${names ? ": " + esc(names) : ""}.</p>`;
    if (r.match){
      html += `<div class="match"><span class="poster" aria-hidden="true" style="${r.match.poster ? `background-image:url(${IMG}w185${r.match.poster})` : ""}"></span>
        <div><p style="margin:0 0 4px;font-weight:600">Treffer! Alle wollen das sehen:</p><h3>${esc(r.match.title)}</h3><p style="margin:0">${esc([r.match.year, r.match.info].filter(Boolean).join(" · "))}</p>
        <p style="margin:8px 0 0"><a href="#t-${r.match.type}-${r.match.id}">Wo läuft das?</a></p></div></div>`;
    } else if (r.n >= 2) html += `<p class="hint">Noch kein Titel, den alle mögen.${r.possible ? ` ${r.possible} sind noch möglich.` : ""}</p>`;
    else html += `<p class="hint">Sobald jemand anders mitmacht, siehst du hier, worauf ihr euch einigt. Schick den Link weiter.</p>`;
    html += r.ranking.length ? `<div class="vrank">${r.ranking.slice(0, 10).map(x => `<div class="vrow"><span class="poster" aria-hidden="true" style="${x.poster ? `background-image:url(${IMG}w92${x.poster})` : ""}"></span>
      <div><b>${esc(x.title)}</b><br><small>${esc(x.yesNames.join(", "))}</small></div><b aria-label="${x.yes} Ja-Stimmen">♥ ${x.yes}</b></div>`).join("")}</div>` : "";
    const url = location.origin + location.pathname + "#abstimmen-" + V.id;
    html += `<div class="linkbox" style="justify-content:center"><button type="button" id="vt-share">Link teilen</button>${left && !V.doc.closed ? `<button type="button" class="primary" id="vt-go">Weiter abstimmen (${left})</button>` : ""}</div>`;
    if (V.doc.closed) html += `<p class="sub">Die Abstimmung ist beendet.</p>`;
    const box = $("vt-box"), had = box.contains(document.activeElement) ? document.activeElement.id : null;
    box.innerHTML = html;
    if (had && $(had)) $(had).focus({preventScroll: true});
    $("vt-share").onclick = async () => {
      try { if (navigator.share){ await navigator.share({title: V.doc.title, url}); return } } catch(e){ if (e.name === "AbortError") return }
      toast(await copy(url) ? "Link kopiert" : url);
    };
    if ($("vt-go")) $("vt-go").onclick = next;
  };
  draw();
  V.timer = setInterval(async () => {
    if (current() !== "abstimmen"){ clearInterval(V.timer); return }
    if (document.hidden) return;
    try { V.doc = await workerApi("/api/vote/" + V.id, {auth: false}); draw() } catch(e){}
  }, 5000);
}
register("abstimmen", id => { if (typeof id === "string") load(id) });
