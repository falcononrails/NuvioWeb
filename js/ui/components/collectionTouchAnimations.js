// Touch has no hover: animate visible collection cards, releasing off-screen decoders.
export function bindCollectionTouchAnimations(container, hydrate) {
  const touch = matchMedia("(hover: none), (pointer: coarse)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const visible = new Set();
  const cards = [...container.querySelectorAll('.home-collection-card[data-focus-gif-enabled="true"]')];
  const refresh = () => {
    const enabled = touch.matches && !reducedMotion.matches && !document.hidden && !container.inert;
    for (const card of cards) hydrate(card, enabled && visible.has(card));
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.25) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    refresh();
  }, { threshold: [0, 0.25] });
  cards.forEach(card => observer.observe(card));
  const routeObserver = new MutationObserver(refresh);
  routeObserver.observe(container, { attributes: true, attributeFilter: ["inert"] });
  document.addEventListener("visibilitychange", refresh);
  touch.addEventListener("change", refresh);
  reducedMotion.addEventListener("change", refresh);
  return () => {
    observer.disconnect();
    routeObserver.disconnect();
    document.removeEventListener("visibilitychange", refresh);
    touch.removeEventListener("change", refresh);
    reducedMotion.removeEventListener("change", refresh);
    cards.forEach(card => hydrate(card, false));
  };
}
