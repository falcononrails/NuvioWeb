import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// These messages are safe to show to the client; raw network errors may contain URLs.
export class SourceReadError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
])
  blocked.addSubnet(ip, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [ip, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20]
])
  blocked.addSubnet(ip, prefix, "ipv6");

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address)
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export async function validateSource(value, resolve = lookup) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    value.length > 8192
  )
    throw new Error("Use a public HTTP or HTTPS media URL on its standard port.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolve(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error("Private network sources are not supported.");
  return { url, address: addresses.find((item) => item.family === 4) || addresses[0] };
}

export function mediaHeaders(value = {}) {
  const headers = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = key.toLowerCase();
    if (!["user-agent", "referer", "origin", "authorization"].includes(name)) continue;
    if (typeof raw !== "string" || raw.length > 4096 || /[\r\n]/.test(raw))
      throw new Error("Invalid media header.");
    headers[name] = raw;
  }
  return headers;
}

// Torrentio can be reachable by the viewer but blocked from a hosting provider.
// Resolve its TorBox reference through the provider's API, using the same cached file.
export async function resolveTorboxSource(value) {
  const url = new URL(value);
  const parts = url.pathname.split("/").slice(1);
  if (url.origin !== "https://torrentio.strem.fun" || parts[0] !== "resolve" ||
      parts[1] !== "torbox" || ![6, 7].includes(parts.length) ||
      !/^[a-zA-Z0-9_-]{16,256}$/.test(parts[2]) || !/^[a-fA-F0-9]{40}$/.test(parts[3]) ||
      !/^\d+$/.test(parts[5])) return value;
  const key = parts[2], hash = parts[3];
  const filename = decodeURIComponent(parts[4]).replaceAll("\\", "/");
  const request = async (path, options = {}) => {
    try {
      const response = await fetch(`https://api.torbox.app/v1/api/torrents/${path}`, {
        ...options, headers: { Authorization: `Bearer ${key}` },
        redirect: "error", signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 1024 * 1024) throw new Error();
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks));
      if (!result.success) throw new Error();
      return result.data;
    } catch {
      // Provider responses and network errors can contain account credentials.
      throw new SourceReadError("TorBox could not prepare this cached file. Refresh sources and try again.");
    }
  };
  const form = new FormData();
  form.set("magnet", `magnet:?xt=urn:btih:${hash}`);
  form.set("add_only_if_cached", "true");
  form.set("allow_zip", "false");
  const created = await request("createtorrent", { method: "POST", body: form });
  const id = created?.torrent_id;
  if (!Number.isSafeInteger(id) || id < 0) throw new SourceReadError("TorBox did not return a cached torrent.");
  const torrent = await request(`mylist?id=${id}&bypass_cache=true`);
  const files = torrent?.files?.filter(file => {
    const name = String(file.name || "").replaceAll("\\", "/");
    return name === filename || name.endsWith(`/${filename}`);
  }) || [];
  if (files.length !== 1 || !Number.isSafeInteger(files[0].id) || files[0].id < 0)
    throw new SourceReadError("The selected file could not be matched on TorBox. Refresh sources and try again.");
  const query = new URLSearchParams({ token: key, torrent_id: String(id), file_id: String(files[0].id),
    redirect: "false", zip_link: "false", append_name: "false" });
  const resolved = await request(`requestdl?${query}`);
  // Keep the same SSRF checks as every other media URL, including subsequent redirects.
  await validateSource(resolved);
  return resolved;
}

// Pin each DNS lookup, including redirects. FFmpeg sees only this local reader.
export async function openSource(value, headers = {}, redirects = 0) {
  const { url, address } = await validateSource(value);
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        headers,
        autoSelectFamily: false,
        lookup: (_host, options, callback) =>
          options.all ? callback(null, [address]) : callback(null, address.address, address.family),
        timeout: 15000
      },
      resolve
    );
    request.on("timeout", () => request.destroy(new SourceReadError("The media host timed out. Try another source.", 504)));
    request.on("error", reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    if (redirects >= 5 || !response.headers.location) throw new Error("Too many source redirects.");
    const next = new URL(response.headers.location, url);
    const forwarded = { ...headers };
    if (next.origin !== url.origin) delete forwarded.authorization;
    return openSource(next.href, forwarded, redirects + 1);
  }
  if (![200, 206].includes(response.statusCode)) {
    response.resume();
    throw Object.assign(
      new SourceReadError(response.statusCode === 429
        ? "The streaming provider is limiting requests (HTTP 429). Wait a moment before trying again."
        : `The media host refused this source (HTTP ${response.statusCode}). Try another source.`),
      { sourceHost: url.hostname, upstreamStatus: response.statusCode }
    );
  }
  const length = Number(
    response.headers["content-range"]?.split("/")[1] || response.headers["content-length"] || 0
  );
  if (length > 25 * 1024 ** 3) {
    response.destroy();
    throw new SourceReadError("This file exceeds the 25 GB conversion limit. Choose a smaller source.");
  }
  return response;
}
