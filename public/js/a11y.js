// Fenster (Details, Listenauswahl, Import) zugänglich machen:
// Fokus bleibt im Fenster, Escape schliesst, danach springt der Fokus zurück, der Rest der Seite ist inaktiv.

const stack = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const page = () => document.querySelector(".wrap");

export function openModal(el, {onClose, focus} = {}){
  if (stack.some(e => e.el === el)){ (focus || el.querySelector(FOCUSABLE))?.focus(); return }
  const prev = document.activeElement;
  const below = stack[stack.length - 1];
  if (below) below.el.setAttribute("inert", ""); else page()?.setAttribute("inert", "");
  stack.push({el, prev, onClose});
  el.hidden = false;
  requestAnimationFrame(() => (typeof focus === "function" ? focus() : focus || el.querySelector(FOCUSABLE))?.focus?.());
}
export function closeModal(el){
  const i = stack.findIndex(e => e.el === el);
  el.hidden = true;
  if (i < 0) return;
  const [e] = stack.splice(i, 1);
  const top = stack[stack.length - 1];
  if (top) top.el.removeAttribute("inert"); else page()?.removeAttribute("inert");
  e.onClose?.();
  if (e.prev && document.contains(e.prev) && !e.prev.closest("[inert]")) e.prev.focus();
}
export const isOpen = el => stack.some(e => e.el === el);

document.addEventListener("keydown", ev => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (ev.key === "Escape"){ ev.preventDefault(); closeModal(top.el); return }
  if (ev.key !== "Tab") return;
  const f = [...top.el.querySelectorAll(FOCUSABLE)].filter(x => x.getClientRects().length);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (!top.el.contains(a)){ ev.preventDefault(); first.focus() }
  else if (ev.shiftKey && a === first){ ev.preventDefault(); last.focus() }
  else if (!ev.shiftKey && a === last){ ev.preventDefault(); first.focus() }
});

// Nach einem Neuzeichnen den Fokus auf denselben Knopf zurücksetzen
export function keepFocus(container, render){
  const a = document.activeElement;
  const fk = a && container.contains(a) ? a.dataset.fk || (a.id ? "#" + a.id : null) : null;
  render();
  if (!fk) return false;
  const el = fk.startsWith("#") ? container.querySelector(fk) : container.querySelector(`[data-fk="${fk}"]`);
  if (el){ el.focus(); return true }
  return false;
}
