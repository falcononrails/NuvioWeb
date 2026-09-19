const failure = (status, message) => Object.assign(new Error(message), { status });

export async function verifyNuvioAccount(bearer, authUrl, apiKey) {
  // This is Nuvio's account check for both email and approved device sessions.
  const response = await fetch(authUrl + "/rest/v1/rpc/get_sync_owner", {
    method: "POST",
    headers: { Authorization: bearer, apikey: apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
    redirect: "error"
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw failure(401, "Nuvio could not verify this session. Please sign in again.");
    throw failure(503, "Nuvio session verification is temporarily unavailable. Try again shortly.");
  }
  const owner = await response.json();
  // Only inspect claims after Nuvio has verified the signed token. An unlinked
  // anonymous device has itself as owner and must not receive a playback slot.
  let claims;
  try { claims = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url")); } catch {}
  if (typeof owner !== "string" || !/^[a-f0-9-]{36}$/i.test(owner) ||
      claims?.role !== "authenticated" || !claims.sub ||
      (claims.is_anonymous && owner === claims.sub))
    throw failure(401, "Sign in to a Nuvio account first.");
  return { id: owner, role: "authenticated" };
}

