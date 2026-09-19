import { AuthManager } from "../../core/auth/authManager.js";
import { registerAccountRuntimeResetHandler } from "../../core/auth/accountLocalDataReset.js";
import { SessionStore } from "../../core/storage/sessionStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { libraryRepository } from "../../data/repository/libraryRepository.js";
import { metaRepository } from "../../data/repository/metaRepository.js";
import { mapWithConcurrency } from "../../core/network/mapWithConcurrency.js";
import { buildReleaseEvents } from "../screens/calendar/releaseCalendar.js";
import { decodeVapidPublicKey, getBrowserPushReturnState } from "./browserPushReturn.js";

const KEY = "browserEpisodeNotifications";
// Account reset revokes this capability before removing it; bulk storage cleanup must leave it intact.
const API = "/api/external-return/episodes";
let revision = 0;
let refreshing = false;
let initialized = false;
export function episodeNotificationPreference() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
const save = value => localStorage.setItem(KEY, JSON.stringify(value));
const revoke = id => fetch(API, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }), keepalive: true, signal: AbortSignal.timeout(8000) });

export function episodeNotificationSchedule(metas, now = Date.now()) {
  return buildReleaseEvents(metas.filter(meta => meta.type === "series"))
    .map(event => ({ key: event.key.slice(0, 200), seriesId: event.meta.id, at: new Date(`${event.date}T09:00:00`).getTime(),
      title: `${event.meta.name || "Series"} · S${event.video.season ?? "?"} E${event.video.episode ?? "?"}`.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 160) }))
    .filter(event => event.at > now && event.at <= now + 30 * 86400000).slice(0, 300);
}

async function updateSchedule(value) {
  if (!await AuthManager.refreshSessionIfNeeded()) throw new Error("Sign in again to update notifications.");
  const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SessionStore.accessToken}` }, body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Couldn't update notifications.");
  return result;
}

export async function enableEpisodeNotifications() {
  if (!AuthManager.isAuthenticated) throw new Error("Sign in to enable notifications.");
  if (!globalThis.Notification || !navigator.serviceWorker || !globalThis.PushManager) throw new Error("This browser doesn't support notifications. On iPhone, install NuvioWeb on your Home Screen first.");
  const generation = AuthManager.getSessionGeneration();
  const version = ++revision;
  // Request immediately from the click, before network awaits (required on iPhone).
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked. Allow them in your browser's site settings." : "Notification permission wasn't granted.");
  const config = await getBrowserPushReturnState();
  if (!config.episodes || !config.registration) throw new Error("Release notifications aren't available on this server.");
  if (localStorage.getItem("browserPushReturnEnabled") == null) localStorage.setItem("browserPushReturnEnabled", String(config.state === "enabled"));
  const subscription = await config.registration.pushManager.getSubscription()
    || await config.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidPublicKey(config.publicKey) });
  const owner = await AuthManager.getEffectiveUserId();
  if (!AuthManager.isSessionCurrent(generation) || version !== revision) return;
  const previous = episodeNotificationPreference();
  const profile = ProfileManager.getActiveProfileId();
  const result = await updateSchedule({ id: previous?.id, subscription: subscription.toJSON(), profile, events: [] });
  if (!AuthManager.isSessionCurrent(generation) || version !== revision) { await revoke(result.id); return; }
  save({ ...result, owner, profile, updated: 0, enabled: true });
  void refreshEpisodeNotifications(true);
}

export async function disableEpisodeNotifications() {
  ++revision;
  const previous = episodeNotificationPreference();
  if (!previous) return;
  // Retain only the revocation capability until a failed/offline deletion can be retried.
  save({ id: previous.id, enabled: false });
  try {
    const response = await revoke(previous.id);
    if (!response.ok) throw new Error("Couldn't turn off notifications. Try again when you're online.");
    if (episodeNotificationPreference()?.id === previous.id) localStorage.removeItem(KEY);
  } catch (error) {
    // Unsubscribing also prevents delivery when the server cannot be reached.
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription && !await subscription.unsubscribe()) throw error;
    throw error;
  }
}

export async function refreshEpisodeNotifications(force = false) {
  const saved = episodeNotificationPreference();
  if (!saved) return;
  if (!saved.enabled) { try { await disableEpisodeNotifications(); } catch {} return; }
  if (!AuthManager.isAuthenticated || refreshing || document.visibilityState === "hidden") return;
  const profile = ProfileManager.getActiveProfileId();
  if (!force && saved.profile === profile && Date.now() - saved.updated < 6 * 3600000) return;
  const version = revision;
  const generation = AuthManager.getSessionGeneration();
  const current = () => version === revision && AuthManager.isSessionCurrent(generation) && ProfileManager.getActiveProfileId() === profile;
  refreshing = true;
  try {
    const owner = await AuthManager.getEffectiveUserId();
    if (!current()) return;
    if (owner !== saved.owner || Notification.permission !== "granted") { await disableEpisodeNotifications(); return; }
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) { await disableEpisodeNotifications(); return; }
    if (saved.profile !== profile) {
      const cleared = await updateSchedule({ id: saved.id, profile, subscription: subscription.toJSON(), events: [] });
      if (!current()) { await revoke(cleared.id); return; }
      Object.assign(saved, cleared, { profile, updated: 0, events: [] });
      save(saved);
    }
    const items = await libraryRepository.getItems({ hydrate: false });
    const seeds = [...new Map(items.filter(item => item.id && item.type === "series").map(item => [item.id, item])).values()].slice(0, 300);
    const metas = [];
    const failed = new Set();
    await mapWithConcurrency(seeds, 2, async item => {
      if (!current()) return;
      try {
        const result = await metaRepository.getMetaFromAllAddons(item.type, item.id);
        if (result.status === "success") metas.push({ ...item, ...result.data, id: item.id, type: item.type });
        else failed.add(item.id);
      } catch { failed.add(item.id); }
    });
    if (!current()) return;
    const events = [...episodeNotificationSchedule(metas), ...(saved.events || []).filter(event => failed.has(event.seriesId) && event.at > Date.now())]
      .sort((a, b) => a.at - b.at).slice(0, 300);
    const result = await updateSchedule({ id: saved.id, profile, subscription: subscription.toJSON(), events });
    if (!current()) { await revoke(result.id); return; }
    save({ ...result, owner, profile, events, updated: Date.now() - (failed.size ? 5.75 * 3600000 : 0), enabled: true,
      error: failed.size ? "Some titles couldn't be checked. Their saved dates are kept; we'll retry." : "" });
  } catch (error) {
    if (current()) save({ ...saved, updated: Date.now() - 5.75 * 3600000, error: String(error.message || "Couldn't refresh release dates.") });
  } finally { refreshing = false; }
}

export function initializeEpisodeNotifications() {
  if (initialized || !navigator.serviceWorker) return;
  initialized = true;
  registerAccountRuntimeResetHandler(async () => { try { await disableEpisodeNotifications(); } catch {} });
  // Opted-in devices only; no metadata requests on the app's startup critical path.
  setTimeout(() => void refreshEpisodeNotifications(), 30000);
  setInterval(() => void refreshEpisodeNotifications(), 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshEpisodeNotifications(); });
}
