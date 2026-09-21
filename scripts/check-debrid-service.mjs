import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const base = process.argv[2] || "https://nuvioweb.space";
// Read-only/auth-rejection probes: never send credentials or create provider torrents.
for (let attempt = 0; ; attempt += 1) {
  try {
    const response = await fetch(new URL("/api/debrid/health", base), { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, "Debrid health route is missing or unavailable");
    const health = await response.json();
    assert.equal(health.ok, true);
    if (process.env.GITHUB_SHA) assert.equal(health.revision, process.env.GITHUB_SHA, "Debrid service is running an older release");
    break;
  } catch (error) {
    if (attempt >= 9) throw error;
    await setTimeout(2000);
  }
}
for (const action of ["cache/check", "torrent/create", "torrent/lookup", "link/resolve"]) {
  const response = await fetch(new URL(`/api/debrid/torbox/${action}`, base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(5000)
  });
  assert.equal(response.status, 401, `Debrid ${action} must require a provider credential`);
  assert.equal((await response.json()).error, "missing_provider_credential");
}
console.log("Debrid health and all TorBox resolver routes verified.");
