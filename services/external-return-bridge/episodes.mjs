import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { verifyNuvioAccount } from "../shared/account.mjs";

const DAY = 86400000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const clean = (value, length) => typeof value === "string" && value.length <= length && !/[\x00-\x1f\x7f]/.test(value);

export function validPushSubscription(subscription) {
  try {
    const url = new URL(subscription.endpoint);
    const hosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
    return url.protocol === "https:" && !url.username && !url.password && !url.port && subscription.endpoint.length <= 2048
      && hosts.some(host => url.hostname === host || url.hostname.endsWith("." + host))
      && /^[A-Za-z0-9_-]{87}=?$/.test(subscription.keys.p256dh)
      && /^[A-Za-z0-9_-]{22}={0,2}$/.test(subscription.keys.auth);
  } catch { return false; }
}

// ponytail: one process and a bounded JSON file; use a database before running replicas.
export function createEpisodeStore({ file, now = Date.now } = {}) {
  let records = {};
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    try { records = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const save = () => {
    if (!file) return;
    writeFileSync(file + ".tmp", JSON.stringify(records), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  };
  const prune = () => {
    let changed = false;
    for (const [id, record] of Object.entries(records)) if (record.expires <= now()) { delete records[id]; changed = true; }
    return changed;
  };
  return {
    put(owner, value) {
      prune();
      if (!validPushSubscription(value.subscription) || !/^[1-6]$/.test(String(value.profile))
        || !Array.isArray(value.events) || value.events.length > 300) throw fail(400, "Invalid notification schedule.");
      const events = value.events.map(event => {
        if (!event || !clean(event.key, 200) || !event.key || !clean(event.title, 160) || !event.title
          || !Number.isSafeInteger(event.at) || event.at < now() - DAY || event.at > now() + 31 * DAY)
          throw fail(400, "Invalid release date or title.");
        return { key: event.key, title: event.title, at: event.at };
      });
      const existing = Object.entries(records).find(([, record]) => record.subscription.endpoint === value.subscription.endpoint);
      if (existing && (existing[1].owner !== owner || existing[0] !== value.id)) throw fail(409, "This device is already registered. Turn alerts off before enabling them again.");
      if (!existing && (Object.keys(records).length >= 500 || Object.values(records).filter(r => r.owner === owner).length >= 8))
        throw fail(429, "Notification device limit reached.");
      const id = existing?.[0] || randomBytes(24).toString("hex");
      const previous = existing?.[1];
      const sent = previous?.profile === String(value.profile) ? previous.sent.filter(entry => entry.at > now() - 35 * DAY).slice(-1000) : [];
      records[id] = { owner, profile: String(value.profile), subscription: { endpoint: value.subscription.endpoint, keys: { p256dh: value.subscription.keys.p256dh, auth: value.subscription.keys.auth } },
        events: [...new Map(events.map(event => [event.key, event])).values()], sent,
        lastDelivery: previous?.lastDelivery || 0,
        starts: previous?.profile === String(value.profile) ? previous.starts : now(), expires: now() + 32 * DAY };
      try { save(); } catch (error) { if (previous) records[id] = previous; else delete records[id]; throw error; }
      return { id, count: events.length, expires: records[id].expires };
    },
    remove(id) {
      if (/^[a-f0-9]{48}$/.test(String(id)) && records[id]) {
        const previous = records[id];
        delete records[id];
        try { save(); } catch (error) { records[id] = previous; throw error; }
      }
    },
    async deliver(send) {
      if (prune()) save();
      for (const [id, record] of Object.entries(records)) {
        if (records[id] !== record) continue;
        if (record.lastDelivery && now() - record.lastDelivery < 20 * 3600000) continue;
        const due = record.events.filter(event => event.at >= record.starts && event.at <= now()
          && event.at > now() - DAY && !record.sent.some(sent => sent.key === event.key));
        if (!due.length) continue;
        // Claim before sending: a restart or ambiguous push timeout must not send duplicate alerts.
        record.sent.push(...due.map(event => ({ key: event.key, at: event.at })));
        record.sent = record.sent.slice(-1000);
        record.lastDelivery = now();
        save();
        try {
          await send(record.subscription, { type: "episode-release", profile: record.profile,
            body: due.slice(0, 3).map(event => event.title).join(" · ").slice(0, 220) + (due.length > 3 ? ` +${due.length - 3} more` : "") });
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) this.remove(id);
          else console.warn("Episode push delivery failed", Number(error.statusCode) || "network");
        }
      }
    }
  };
}

export function createEpisodeHandler({ store, env, authenticate = verifyNuvioAccount }) {
  let active = 0;
  return async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    };
    if (!["POST", "DELETE"].includes(req.method)) return reply(405, { error: "Method not allowed." });
    if (req.headers.origin && req.headers.origin !== env.NUVIO_ORIGIN) return reply(403, { error: "Origin not allowed." });
    if (active >= 8) return reply(429, { error: "Notification service is busy. Try again shortly." });
    active++;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 131072) throw fail(413, "Schedule too large.");
      }
      let value;
      try { value = JSON.parse(body); } catch { throw fail(400, "Invalid request."); }
      if (!value || typeof value !== "object") throw fail(400, "Invalid request.");
      // This random capability can only revoke its own device. It remains usable after sign-out.
      if (req.method === "DELETE") { store.remove(value.id); return reply(200, { enabled: false }); }
      if (!env.NUVIO_WEB_PUSH_PRIVATE_KEY || !env.NUVIO_SUPABASE_URL || !env.NUVIO_SUPABASE_ANON_KEY)
        throw fail(503, "Release notifications are not configured on this server.");
      const bearer = req.headers.authorization || "";
      if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(bearer)) throw fail(401, "Sign in to enable notifications.");
      const owner = await authenticate(bearer, env.NUVIO_SUPABASE_URL, env.NUVIO_SUPABASE_ANON_KEY);
      reply(200, store.put(owner.id, value));
    } catch (error) {
      reply(error.status || 503, { error: error.status ? error.message : "Couldn't update notifications. Try again shortly." });
    } finally { active--; }
  };
}
