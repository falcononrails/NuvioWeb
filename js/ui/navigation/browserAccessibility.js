import { ScreenUtils, ensureSpatialFocusVisible } from "./screen.js";

const CONTROLS = 'button, a[href], input, select, textarea, summary, iframe, video[controls], [tabindex], .focusable';
const GROUPS = '.desktop-navigation, [role="tablist"], .library-view-mode-row, .stream-route-chip-track, .series-season-row, .series-insight-tabs';
const DIALOGS = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const LEGACY_DIALOGS = '.settings-dialog, .library-dialog';
const CHOICES = '.library-view-mode-button, .stream-route-chip, .series-season-btn, .series-season-poster-btn, .series-insight-tab, .player-dialog-item[data-speed-index], [data-audio-column="track"]';
const LEGACY_CONTROLS = 'button[tabindex="-1"]:not([data-calendar-date]):not([role="tab"]), [role="button"][tabindex="-1"]';

function syncChoice(node) {
  node.setAttribute("aria-pressed", String(node.classList.contains("selected") || node.classList.contains("is-active")));
}

function rememberControl(node) {
  const root = node?.closest?.('.screen') || document.body;
  const attributes = node?.getAttributeNames?.().filter(name => name.startsWith("data-") && name !== "data-index") || [];
  const selector = node?.id ? `#${CSS.escape(node.id)}` : attributes.length
    ? node.tagName + attributes.map(name => `[${name}="${CSS.escape(node.getAttribute(name))}"]`).join("") : null;
  return () => node?.isConnected ? node : selector && root.isConnected ? root.querySelector(selector) : null;
}

export function browserAccessibilityEnabled() {
  return Boolean(globalThis.document?.documentElement?.classList?.contains?.("desktop-browser"));
}

export function isKeyboardEditable(node) {
  return Boolean(node?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

export function isAvailableControl(node) {
  return !node.matches(':disabled, [aria-disabled="true"]') &&
    !node.closest('[hidden], .hidden, [inert], [aria-hidden="true"]') &&
    node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
}

export function keyboardControls(root) {
  return [...root.querySelectorAll(CONTROLS)].filter(node => node.tabIndex >= 0 && isAvailableControl(node));
}

export function trapDialogTab(event, dialog) {
  if (event.key !== "Tab") return false;
  const controls = keyboardControls(dialog);
  const index = controls.indexOf(document.activeElement);
  if (!controls.length || index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
    event.preventDefault();
    const target = event.shiftKey ? controls.at(-1) : controls[0];
    if (!target) dialog.tabIndex = -1;
    (target || dialog).focus({ preventScroll: true });
  }
  return true;
}

function prepareControls(root) {
  const dialogs = [...root.querySelectorAll(LEGACY_DIALOGS)];
  if (root.matches?.(LEGACY_DIALOGS)) dialogs.unshift(root);
  for (const dialog of dialogs) {
    if (dialog.hasAttribute("role")) continue;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const title = dialog.querySelector('.settings-dialog-title, .library-dialog-title')?.textContent.trim() || "Options";
    dialog.setAttribute("aria-label", title);
    dialog.querySelectorAll('input:not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby])').forEach(field => {
      if (!field.closest('label')) field.setAttribute("aria-label", field.placeholder || title);
    });
  }
  const nodes = [...root.querySelectorAll(`.focusable, ${LEGACY_CONTROLS}, button[title], .material-icons`)];
  if (root.matches?.(`.focusable, button, .material-icons, ${LEGACY_CONTROLS}`)) nodes.unshift(root);
  for (const node of nodes) {
    if (node.matches('.material-icons')) {
      node.setAttribute("aria-hidden", "true");
      continue;
    }
    if (node.matches('.focusable') || node.matches(LEGACY_CONTROLS)) {
      if (!node.matches('[role="tab"], [role="gridcell"]')) node.tabIndex = 0;
      if (!node.matches('button, a[href], input, select, textarea, [role]')) {
        // Cards containing a download/menu button keep that independent control.
        node.setAttribute("role", node.querySelector('button, a[href], input') ? "group" : "button");
      }
    }
    if (node.matches(CHOICES)) syncChoice(node);
    if (node.matches('button[title]:not([aria-label]):not([aria-labelledby])')) {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"], .material-icons').forEach(icon => icon.remove());
      if (!copy.textContent.trim()) node.setAttribute("aria-label", node.title);
    }
  }
}

// Legacy screens replace their markup directly. Adapt newly rendered controls
// once, instead of polling the player or maintaining a second keyboard per screen.
export function initBrowserAccessibility() {
  if (!browserAccessibilityEnabled() || !globalThis.MutationObserver) return;
  let lastFocused = document.activeElement;
  let restoreFocus = rememberControl(lastFocused);
  let lastInteraction = null;
  let modal = null;
  let opener = null;
  let background = [];
  const releaseBackground = () => {
    background.forEach(([node, inert]) => { node.inert = inert; });
    background = [];
  };
  const syncModal = () => {
    const next = [...document.querySelectorAll(DIALOGS)].filter(node =>
      !node.closest('[hidden], .hidden, [aria-hidden="true"]') && node.getClientRects().length
    ).at(-1) || null;
    if (next === modal) return;
    const previous = modal;
    releaseBackground();
    modal = next;
    if (next) {
      if (!previous) opener = lastInteraction || restoreFocus;
      for (let node = next; node.parentElement && node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          // A separate dismiss backdrop must still receive pointer events.
          if (sibling !== node && !sibling.matches('script, style, link, [data-dialog-backdrop]')) {
            background.push([sibling, sibling.inert]);
            sibling.inert = true;
          }
        }
      }
      if (!next.contains(document.activeElement)) {
        next.tabIndex = -1;
        (keyboardControls(next)[0] || next).focus({ preventScroll: true });
      }
    } else if (previous) {
      const returnTarget = opener?.();
      if (returnTarget?.isConnected && isAvailableControl(returnTarget) &&
          (document.activeElement === document.body || previous.contains(document.activeElement))) {
        returnTarget.focus({ preventScroll: true });
      }
      opener = null;
    }
  };
  prepareControls(document.body);
  const observer = new MutationObserver(records => {
    let dialogsChanged = false;
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          prepareControls(node);
          if (node.matches(DIALOGS) || node.querySelector(DIALOGS)) dialogsChanged = true;
        }
        if (modal && !modal.isConnected) dialogsChanged = true;
      } else {
        if (record.target.matches(DIALOGS)) dialogsChanged = true;
        if (record.attributeName === "class" && record.target.matches(CHOICES)) syncChoice(record.target);
      }
    }
    if (dialogsChanged) syncModal();
    if (!lastFocused?.isConnected && document.activeElement === document.body) {
      const replacement = restoreFocus();
      if (replacement && isAvailableControl(replacement) && (!modal || modal.contains(replacement))) {
        replacement.focus({ preventScroll: true });
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] });
  document.addEventListener("focusin", event => {
    if (modal?.isConnected && isAvailableControl(modal) && !modal.contains(event.target)) {
      (keyboardControls(modal)[0] || modal).focus({ preventScroll: true });
      return;
    }
    lastFocused = event.target;
    restoreFocus = rememberControl(event.target);
    const screen = event.target.closest?.(".screen");
    screen?.querySelectorAll(".focusable.focused").forEach(node => {
      if (node !== event.target) node.classList.remove("focused");
    });
    if (event.target.matches?.(".focusable")) event.target.classList.add("focused");
  }, true);
  for (const type of ["click", "contextmenu"]) document.addEventListener(type, event => {
    if (!modal) lastInteraction = rememberControl(event.target.closest?.(CONTROLS) || document.activeElement);
  }, true);
  document.addEventListener("keydown", event => {
    if (!modal) lastInteraction = rememberControl(event.target);
  }, true);
  syncModal();
}

// Return true to leave TV key handlers out of a native browser interaction.
export function handleBrowserControlKey(event, screen) {
  if (!browserAccessibilityEnabled()) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return true;
  const dialog = target.closest(DIALOGS);
  if (event.key === "Tab") {
    if (screen?.revealDesktopPlayerControls && !screen.controlsVisible && !screen.isDialogOpen?.()) screen.revealDesktopPlayerControls();
    if (dialog) trapDialogTab(event, dialog);
    return true;
  }
  if (isKeyboardEditable(target) && event.key !== "Escape") return true;
  if (target.matches('[data-calendar-date]')) return event.key !== "Escape";
  const control = target.closest(CONTROLS);
  if (!control || control === screen?.uiRefs?.root) return false;
  if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
    event.preventDefault();
    control.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return true;
  }
  if (control.matches('[role="slider"]')) return false;
  if (event.key === "Enter" || event.key === " ") {
    if (control.matches(':disabled, [aria-disabled="true"]')) { event.preventDefault(); return true; }
    if (!control.matches('button, a[href], summary, video, iframe')) {
      event.preventDefault();
      if (!event.repeat && isAvailableControl(control)) control.click();
    }
    return true;
  }
  if (control.matches('[role="slider"], video, iframe')) return false;
  const group = control.closest(GROUPS);
  if (group && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    const items = [...group.querySelectorAll('button, [role="tab"]')].filter(isAvailableControl);
    const index = items.indexOf(control);
    const rtl = getComputedStyle(group).direction === "rtl";
    const delta = (event.key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1);
    const next = event.key === "Home" ? items[0] : event.key === "End" ? items.at(-1) : items[(index + delta + items.length) % items.length];
    if (next) {
      event.preventDefault();
      next.focus({ preventScroll: true });
      ensureSpatialFocusVisible(next);
    }
    return true;
  }
  const direction = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[event.key];
  if (direction) {
    const root = dialog || screen?.container || target.closest(".screen");
    if (!root) return false;
    event.preventDefault();
    ScreenUtils.moveFocusDirectional(root, direction, CONTROLS);
    return true;
  }
  // Player shortcuts apply to its playback surface, not a chooser or toolbar.
  if (dialog || target.closest('#playerControlButtons, .player-desktop-playback-tools')) return event.key !== "Escape";
  return false;
}
