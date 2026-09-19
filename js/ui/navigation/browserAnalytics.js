const WEBSITE_ID = "551048bd-896f-4db1-82f1-6e221709955f";
const HOSTNAME = "nuvioweb.space";
let requested = false;
let pendingScreen = "";
let previousPath = "";

function trackingAllowed() {
  return typeof window !== "undefined"
    && window.location?.hostname === HOSTNAME
    && window.navigator?.doNotTrack !== "1"
    && window.doNotTrack !== "1"
    && !window.navigator?.globalPrivacyControl;
}

function sendPageview() {
  if (!trackingAllowed() || !pendingScreen || typeof window.umami?.track !== "function") return;
  const path = pendingScreen === "Home" ? "/" : `/${pendingScreen.toLowerCase().replace(/\s+/g, "-")}`;
  if (path === previousPath) return;
  let referrer = previousPath ? `https://${HOSTNAME}${previousPath}` : "";
  if (!previousPath && document.referrer) {
    try {
      const source = new URL(document.referrer);
      if (source.protocol === "https:" || source.protocol === "http:") referrer = source.origin;
    } catch { /* A malformed referrer must not interrupt navigation. */ }
  }
  // Explicit payload: never read document.title, location.href or route parameters.
  try {
    Promise.resolve(window.umami.track({
      website: WEBSITE_ID,
      hostname: HOSTNAME,
      url: path,
      title: `${pendingScreen} - NuvioWeb`,
      referrer,
      language: window.navigator.language,
      screen: `${window.screen.width}x${window.screen.height}`
    })).catch(() => {});
    previousPath = path;
  } catch { /* Analytics is optional and must never block the app. */ }
}

// screenName comes only from the fixed route labels in browserDocumentTitle.
export function trackBrowserScreen(screenName) {
  if (!trackingAllowed() || !screenName) return;
  pendingScreen = screenName;
  if (!requested) {
    requested = true;
    const script = document.createElement("script");
    script.src = "https://cloud.umami.is/script.js";
    script.async = true;
    script.dataset.websiteId = WEBSITE_ID;
    script.dataset.autoTrack = "false";
    script.dataset.doNotTrack = "true";
    script.referrerPolicy = "no-referrer";
    script.onload = sendPageview;
    document.head.appendChild(script);
  }
  sendPageview();
}
