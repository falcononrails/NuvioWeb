import { Router } from "../navigation/router.js";
import { I18n } from "../../i18n/index.js";

const NAVIGATION_ITEMS = [
  {
    route: "home",
    labelKey: "sidebar.home",
    fallback: "Home",
    icon: "assets/icons/sidebar_home.svg"
  },
  {
    route: "search",
    labelKey: "sidebar.search",
    fallback: "Search",
    icon: "assets/icons/sidebar_search.svg"
  },
  {
    route: "library",
    labelKey: "sidebar.library",
    fallback: "Library",
    icon: "assets/icons/sidebar_library.svg"
  },
  {
    route: "settings",
    labelKey: "sidebar.settings",
    fallback: "Settings",
    icon: "assets/icons/sidebar_settings.svg"
  }
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

function renderIcon(item) {
  return `<span class="desktop-navigation-icon-slot" aria-hidden="true"><span class="desktop-navigation-icon" style="mask-image:url('${item.icon}');-webkit-mask-image:url('${item.icon}')"></span></span>`;
}

function renderProfile(profile, selectedRoute) {
  const profileState = profile || {};
  const label = t("sidebar.profileFallback", "Profile");
  const name = String(profileState.activeProfileName || label).trim() || label;
  const initial = String(profileState.activeProfileInitial || name.charAt(0) || "P").charAt(0).toUpperCase();
  const color = String(profileState.activeProfileColorHex || "#1E88E5");
  const avatarUrl = String(profileState.activeProfileAvatarUrl || "").trim();
  const isActive = selectedRoute === "profileSelection";

  return `
    <button class="desktop-navigation-item desktop-navigation-profile${isActive ? " is-active" : ""}"
            type="button"
            data-desktop-route="profileSelection"
            aria-label="${escapeHtml(label)}"${isActive ? ' aria-current="page"' : ""}>
      <span class="desktop-navigation-avatar" style="background:${escapeHtml(color)}">
        ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="" />` : escapeHtml(initial)}
      </span>
      <span class="desktop-navigation-label">${escapeHtml(label)}</span>
    </button>
  `;
}

export function renderDesktopNavigation({ selectedRoute = "", profile = null } = {}) {
  const currentRoute = String(selectedRoute || "");
  return `
    <a class="desktop-skip-link" href="#main-content" data-skip-content>Skip to content</a>
    <nav class="desktop-navigation" aria-label="Primary navigation">
      <div class="desktop-navigation-scroll">
        ${NAVIGATION_ITEMS.map((item) => {
          const label = t(item.labelKey, item.fallback);
          const isActive = item.route === currentRoute;
          return `
            <button class="desktop-navigation-item${isActive ? " is-active" : ""}"
                    type="button"
                    data-desktop-route="${item.route}"${isActive ? ' aria-current="page"' : ""}>
              ${renderIcon(item)}
              <span class="desktop-navigation-label">${escapeHtml(label)}</span>
            </button>
          `;
        }).join("")}
        ${renderProfile(profile, currentRoute)}
      </div>
    </nav>
  `;
}

function navigateTo(route) {
  if (route === "home" && Router.getCurrent() === "home") {
    Router.getCurrentScreen()?.onSidebarReselect?.();
    return;
  }
  void Router.navigate(route);
}

export function bindDesktopNavigationEvents(container) {
  const skip = container?.querySelector('[data-skip-content]');
  if (skip) skip.onclick = event => {
    event.preventDefault();
    const content = container.querySelector('main, [role="main"], h1, h2');
    if (content) { content.tabIndex = -1; content.focus({ preventScroll: true }); }
  };
  container?.querySelectorAll(".desktop-navigation [data-desktop-route]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateTo(String(button.dataset.desktopRoute || ""));
    };
  });
}
