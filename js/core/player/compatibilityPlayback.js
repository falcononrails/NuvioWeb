import { AuthManager } from "../auth/authManager.js";
import { SessionStore } from "../storage/sessionStore.js";

export async function requestCompatibilityPlayback(path = "", data = {}) {
  if (SessionStore.isAnonymousSession || !(await AuthManager.refreshSessionIfNeeded())) {
    throw new Error("Sign in to Nuvio to use compatibility playback.");
  }
  if (!path && data.url) {
    // Addon redirectors can accept the viewer's connection but reject a VPS.
    // Resolve the file here, then let the bridge validate and read that URL.
    try {
      const response = await fetch(data.url, {
        headers: { ...data.headers, Range: "bytes=0-0" },
        credentials: "omit",
        signal: AbortSignal.timeout(8000)
      });
      console.info("[Nuvio playback] source resolved", {
        host: response.url ? new URL(response.url).hostname : null, status: response.status
      });
      await response.body?.cancel();
      const resolved = new URL(response.url);
      if (response.ok && /^https?:$/.test(resolved.protocol)) {
        const sameOrigin = resolved.origin === new URL(data.url).origin;
        const headers = Object.fromEntries(Object.entries(data.headers || {})
          .filter(([name]) => sameOrigin || name.toLowerCase() !== "authorization"));
        data = { ...data, url: resolved.href, headers };
      }
    } catch (error) {
      // CORS-restricted sources can still be read directly by the bridge.
      console.info("[Nuvio playback] source resolution unavailable", { reason: error.name });
    }
  }
  const send = () => fetch(`/api/playback/sessions${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SessionStore.accessToken}`
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(60000)
  });
  let response = await send();
  if (response.status === 401 && await AuthManager.refreshSessionIfNeeded({ force: true })) {
    response = await send();
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Compatibility playback is unavailable on this server.");
  return result;
}

export function closeCompatibilityPlayback(id) {
  if (!id) return;
  void fetch(`/api/playback/sessions/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
}
