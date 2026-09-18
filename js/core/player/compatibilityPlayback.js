import { AuthManager } from "../auth/authManager.js";
import { SessionStore } from "../storage/sessionStore.js";

export async function requestCompatibilityPlayback(path = "", data = {}) {
  if (SessionStore.isAnonymousSession || !(await AuthManager.refreshSessionIfNeeded())) {
    throw new Error("Sign in to Nuvio to use compatibility playback.");
  }
  const response = await fetch(`/api/playback/sessions${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SessionStore.accessToken}`
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(60000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Compatibility playback is unavailable on this server.");
  return result;
}

export function closeCompatibilityPlayback(id) {
  if (!id) return;
  void fetch(`/api/playback/sessions/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
}
