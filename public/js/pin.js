// Kinderschutz: Haushalts-PIN (nur als Prüfsumme gespeichert) und Abfrage-Fenster
import { S, changed, profile } from "./state.js";
import { $ } from "./util.js";
import { openModal, closeModal } from "./a11y.js";

async function digest(salt, pin){
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pin));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const hasPin = () => !!S.household?.hash;
export async function setPin(pin){
  if (!pin){ S.household = {}; changed("household"); return }
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
  S.household = {salt, hash: await digest(salt, pin), t: Date.now()};
  changed("household");
}
export async function checkPin(pin){ return hasPin() && await digest(S.household.salt, pin) === S.household.hash }

const limitOf = p => p?.maxFsk === null || p?.maxFsk === undefined || p?.maxFsk === "" ? 99 : +p.maxFsk;
// Ist das aktive Profil eingeschränkt und darf es nicht einfach weg?
export const restricted = () => hasPin() && limitOf(profile()) < 99;
export const needsPinFor = targetId => restricted() && limitOf(S.profiles.find(p => p.id === targetId)) > limitOf(profile());

let unlockedUntil = 0;
export const unlocked = () => Date.now() < unlockedUntil;
let resolver = null;
export function askPin(why){
  if (!restricted() || unlocked()) return Promise.resolve(true);
  $("pin-why").textContent = why; $("pin-in").value = ""; $("pin-err").textContent = "";
  return new Promise(res => {
    resolver = res;
    openModal($("pin"), {focus: () => $("pin-in"), onClose: () => { if (resolver){ resolver(false); resolver = null } }});
  });
}
$("pin-check").addEventListener("submit", async e => {
  e.preventDefault();
  if (await checkPin($("pin-in").value.trim())){
    unlockedUntil = Date.now() + 5 * 6e4;
    const r = resolver; resolver = null; closeModal($("pin")); r?.(true);
  } else { $("pin-err").textContent = "Die PIN stimmt nicht."; $("pin-in").select() }
});
$("pin-cancel").addEventListener("click", () => closeModal($("pin")));
