// Swipe thresholds adapted from NurvX/NuvioWeb's phoneHeroPager.js (GPL-3.0).
// https://github.com/NurvX/NuvioWeb/blob/8194181f/js/ui/components/phoneHeroPager.js
export function heroSwipeDirection(dx, dy, elapsed, width) {
  if (Math.abs(dx) < 16 || Math.abs(dx) <= Math.abs(dy) || width <= 0) return 0;
  return Math.abs(dx) / width >= 0.16 || Math.abs(dx) / Math.max(1, elapsed) >= 0.3
    ? dx < 0 ? 1 : -1 : 0;
}

// DOM updates replace attributes while keeping the element and its listeners.
const boundCards = new WeakSet();

export function bindBrowserHeroSwipe(card, { rotate, pause, resume }) {
  if (boundCards.has(card)) return;
  boundCards.add(card);
  let gesture = null;
  let suppressClickUntil = 0;
  card.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" || !matchMedia("(max-width: 600px)").matches || event.target.closest("button, a")) return;
    gesture = { x: event.clientX, y: event.clientY, time: event.timeStamp, id: event.pointerId };
    pause();
  });
  card.addEventListener("pointerup", event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const direction = heroSwipeDirection(dx, dy, event.timeStamp - gesture.time, card.clientWidth);
    if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy)) suppressClickUntil = Date.now() + 500;
    gesture = null;
    if (direction) rotate(direction);
    resume();
  });
  card.addEventListener("pointercancel", () => { gesture = null; resume(); });
  card.addEventListener("click", event => {
    if (Date.now() > suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
