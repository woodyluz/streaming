// Posterkarten, Personen-Chips und die gebündelte Prüfung von Verfügbarkeit und Altersfreigabe.
import { S, P, on, profileFsk } from "./state.js";
import { IMG } from "./constants.js";
import { esc, titleOf, yearOf, pool } from "./util.js";
import { regions, certOf } from "./api.js";
import { remember, isSaved, statusOf, listCount, ITEMS } from "./data.js";
import { posterHTML } from "./posters.js";

export const bookmark = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;
const saveLabel = (title, saved) => saved ? `„${title}“ ist gemerkt, Listen ändern` : `„${title}“ merken`;

export function cardHTML(it, o = {}){
  const key = remember(it), type = it.media_type || it.type, saved = isSaved(key), title = titleOf(it), orig = ITEMS.get(key)?.orig || "";
  const pp = it.poster_path || it.poster || null;
  const meta = o.meta ?? `${type === "tv" ? "Serie" : "Film"}${yearOf(it) ? " · " + yearOf(it) : ""}`;
  const chip = o.chip ? `<span class="chip ${o.chip.kind}">${esc(o.chip.text)}</span>` : `<span class="chip wait" aria-hidden="true">·</span>`;
  const badge = S.track[key]?.n && saved ? `<span class="new">Neu für dich</span>` : P().watched[key] ? `<span class="seen">Gesehen</span>` : "";
  return `<article class="card${o.row ? " rowcard" : ""}${o.row && !o.rank ? " norank" : ""}" data-key="${key}" data-type="${type}" data-id="${it.id}"${o.chip ? ` data-preset="${o.chip.kind}"` : ""}${o.row ? ' role="listitem"' : ""}>
    ${o.rank ? `<span class="rank" aria-label="Platz ${o.rank}">${o.rank}</span>` : ""}
    <button class="hit" type="button" aria-label="${esc(title)}, ${esc(meta)}, Details öffnen">
      ${posterHTML(pp, {url: it.posterUrl || null, title, key})}
      <span class="ct" aria-hidden="true"><b>${esc(title)}</b>${orig ? `<small class="orig">${esc(orig)}</small>` : ""}<small>${esc(meta)}</small></span>
    </button>
    ${chip}
    <button class="save${saved ? " on" : ""}" type="button" aria-pressed="${saved}" aria-label="${esc(saveLabel(title, saved))}">${bookmark}</button>
    ${badge}
  </article>`;
}

export const personHTML = p => `<a class="person" href="#p-${p.id}"><i aria-hidden="true" style="${p.profile_path ? `background-image:url(${IMG}w185${p.profile_path})` : ""}"></i>${esc(p.name)}${p.sub ? `<small>${esc(p.sub)}</small>` : ""}</a>`;

// Altersgrenze: ausdrücklich gewählt (Filter) und/oder vom Profil vorgegeben
export function fskLimit(explicit){
  const prof = profileFsk(), ex = explicit === "" || explicit == null ? null : +explicit;
  if (prof === null) return {limit: ex, strict: false};
  return {limit: ex === null ? prof : Math.min(ex, prof), strict: true};
}

// Verfügbarkeit (gebündelt) und Altersfreigabe für alle noch offenen Karten nachladen
export async function decorate(root, {after, fsk} = {}){
  const cards = [...root.querySelectorAll(".card:not([data-done])")];
  if (!cards.length) return;
  cards.forEach(c => c.dataset.done = "1");
  const need = cards.filter(c => !c.dataset.preset);
  const reg = need.length ? await regions(need.map(c => ({type: c.dataset.type, id: +c.dataset.id}))).catch(() => new Map()) : new Map();
  for (const c of cards){
    if (c.dataset.preset){ c.dataset.kind = c.dataset.preset; continue }
    const chip = c.querySelector(".chip"), r = reg.get(c.dataset.type + ":" + c.dataset.id);
    if (r === undefined){ chip.className = "chip"; chip.textContent = "Unbekannt"; c.dataset.kind = "none"; continue }
    const s = statusOf(r);
    chip.className = "chip " + s.kind; chip.textContent = s.text; chip.removeAttribute("aria-hidden"); c.dataset.kind = s.kind;
  }
  const {limit, strict} = fskLimit(fsk);
  if (limit !== null){
    await pool(cards, 6, async c => {
      const n = await certOf(c.dataset.type, c.dataset.id).catch(() => null);
      if (n === null ? strict : n > limit){ c.hidden = true; c.dataset.blocked = "1" }
    });
  }
  if (after) cards.forEach(after);
}

// Merken-Knöpfe überall aktuell halten
export function refreshSave(key){
  const saved = isSaved(key), n = listCount(key);
  for (const b of document.querySelectorAll(`.card[data-key="${key}"] .save`)){
    b.classList.toggle("on", saved); b.setAttribute("aria-pressed", saved);
    const t = b.closest(".card").querySelector(".ct b")?.textContent || "";
    b.setAttribute("aria-label", saveLabel(t, saved));
  }
  for (const db of document.querySelectorAll(`[data-pick="${key}"]`)){
    db.textContent = n ? (n > 1 ? `In ${n} Listen` : "Gemerkt") : "Merken";
    db.classList.toggle("primary", !n);
  }
}
on("saved", refreshSave);

// Wischen auf dem Handy: nach rechts merken, nach links als gesehen markieren
export function enableSwipe({right, left}){
  let st = null, blockClick = false;
  document.addEventListener("pointerdown", e => {
    if (e.pointerType !== "touch") return;
    const c = e.target.closest(".grid > .card, .rail > .card");
    if (!c || e.target.closest(".save")) return;
    st = {c, x: e.clientX, y: e.clientY, dx: 0, on: false};
  }, {passive: true});
  document.addEventListener("pointermove", e => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.on){
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)){ st = null; return }
      if (Math.abs(dx) < 14) return;
      st.on = true;
    }
    st.dx = dx;
    st.c.style.transform = `translateX(${Math.max(-110, Math.min(110, dx))}px) rotate(${dx / 40}deg)`;
    st.c.classList.toggle("sw-right", dx > 70); st.c.classList.toggle("sw-left", dx < -70);
  }, {passive: true});
  const end = () => {
    if (!st) return;
    const {c, dx, on: was} = st; st = null;
    c.style.transform = ""; c.classList.remove("sw-right", "sw-left");
    if (!was) return;
    blockClick = true; setTimeout(() => blockClick = false, 350);
    if (dx > 70) right(c.dataset.key); else if (dx < -70) left(c.dataset.key);
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  document.addEventListener("click", e => { if (blockClick && e.target.closest(".card")){ e.stopPropagation(); e.preventDefault() } }, true);
}
