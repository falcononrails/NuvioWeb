import { Platform } from "../../platform/index.js";
import { trackBrowserScreen } from "./browserAnalytics.js";

const APP_TITLE = "Nuvio";

const ROUTE_TITLES = {
  home: "",
  search: "Search",
  discover: "Discover",
  library: "Library",
  calendar: "Calendar",
  settings: "Settings",
  profileSelection: "Profiles",
  authSignIn: "Sign In",
  authQrSignIn: "Sign In",
  syncCode: "Sign In",
  account: "Account",
  plugin: "Addons",
  plugins: "Plugins",
  catalogOrder: "Catalogs",
  collectionEdit: "Collections",
  collectionFolderEdit: "Collections",
  folderDetail: "Collections",
  catalogSeeAll: "Browse",
  castDetail: "Cast",
  supportersContributors: "About",
  licensesAttributions: "About",
  debugConsole: "Console Debug",
  trakt: "Tracking",
  stream: "Select Stream",
  detail: "Details",
  player: ""
};

function normalizeTitlePart(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeYear(value) {
  const match = normalizeTitlePart(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

export function setBrowserDocumentTitle(value = "") {
  if (!Platform.isBrowser() || typeof document === "undefined") {
    return;
  }
  const title = normalizeTitlePart(value);
  document.title = title ? `${title} - ${APP_TITLE}` : APP_TITLE;
}

export function setBrowserRouteTitle(routeName) {
  const route = String(routeName || "").trim();
  setBrowserDocumentTitle(ROUTE_TITLES[route] || "");
  if (Object.hasOwn(ROUTE_TITLES, route)) {
    trackBrowserScreen(ROUTE_TITLES[route] || (route === "player" ? "Player" : "Home"));
  }
}

export function setBrowserMediaTitle({
  title,
  year,
  season = null,
  episode = null,
  episodeTitle = ""
} = {}) {
  const mediaTitle = normalizeTitlePart(title);
  const releaseYear = normalizeYear(year);
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  const episodeCode =
    Number.isFinite(seasonNumber) &&
    seasonNumber >= 0 &&
    Number.isFinite(episodeNumber) &&
    episodeNumber > 0
      ? `S${seasonNumber}E${episodeNumber}`
      : "";
  const parts = [
    [mediaTitle, releaseYear ? `(${releaseYear})` : ""].filter(Boolean).join(" "),
    episodeCode,
    normalizeTitlePart(episodeTitle)
  ].filter(Boolean);
  setBrowserDocumentTitle(parts.join(" "));
}
