// Auswahl, auf welche Listen ein Titel kommt
import { P } from "./state.js";
import { $, esc, toast } from "./util.js";
import { ITEMS, inList, isSaved, setInList, newList } from "./data.js";
import { openModal, closeModal } from "./a11y.js";
import { guestTarget } from "./views/collab.js";

let pickKey = null;
function draw(){
  $("pick-title").textContent = "Speichern: " + (ITEMS.get(pickKey)?.title || "");
  $("pick-lists").innerHTML = P().lists.map(l => `<label class="opt"><input type="checkbox" data-l="${l.id}" ${inList(l, pickKey) ? "checked" : ""}> ${esc(l.name)} <span class="empty" style="margin-left:auto">${l.items.length}</span></label>`).join("");
}
export function openPicker(key){
  if (!ITEMS.get(key)) return;
  pickKey = key; draw();
  openModal($("picker"), {focus: () => $("pick-lists").querySelector("input") || $("pick-done")});
}
export function onSave(key){
  const g = guestTarget();
  if (g){
    const on = !g.items.some(i => i.key === key);
    setInList(g.id, key, on);
    toast(on ? `Zu „${g.name}“ hinzugefügt` : `Aus „${g.name}“ entfernt`);
    return;
  }
  const lists = P().lists;
  if (lists.length === 1){
    setInList(lists[0].id, key, !isSaved(key));
    toast(isSaved(key) ? `Auf „${lists[0].name}“ gemerkt` : "Von der Liste entfernt");
  } else openPicker(key);
}
$("pick-lists").addEventListener("change", e => {
  const c = e.target.closest("[data-l]");
  if (c){ setInList(c.dataset.l, pickKey, c.checked); c.closest("label").querySelector(".empty").textContent = P().lists.find(l => l.id === c.dataset.l)?.items.length ?? "" }
});
$("pick-new").addEventListener("submit", e => {
  e.preventDefault();
  const n = $("pick-name").value.trim(); if (!n) return;
  const l = newList(n); $("pick-name").value = "";
  setInList(l.id, pickKey, true); draw();
  $("pick-lists").querySelector(`[data-l="${l.id}"]`)?.focus();
  toast(`Liste „${l.name}“ angelegt`);
});
$("pick-done").addEventListener("click", () => closeModal($("picker")));
$("picker").addEventListener("click", e => { if (e.target.id === "picker") closeModal($("picker")) });
