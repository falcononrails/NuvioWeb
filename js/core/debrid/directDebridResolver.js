import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import { DebridApi } from "../../data/remote/api/debridApi.js";
import { I18n } from "../../i18n/index.js";
import { DEBRID_CAPABILITIES, DEBRID_PROVIDER_IDS, DebridProviders } from "./debridProviders.js";
import {
  getDebridFileDisplayName,
  getDebridFileSize,
  selectDebridFile
} from "./debridFileSelection.js";

const RESOLVE_CACHE_TTL_MS = 15 * 60 * 1000;
const RESOLVE_CACHE_MAX_ENTRIES = 100;
const resolvedCache = new Map();
const inFlightResolves = new Map();

function isMagnetLink(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

function getStreamUrl(stream = {}) {
  return [stream.url, stream.externalUrl].find((value) => value && !isMagnetLink(value)) || null;
}

function torrentMagnetUri(stream = {}) {
  return [stream.url, stream.externalUrl].find((value) => isMagnetLink(value)) || null;
}

function isDirectDebrid(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve;
  return Boolean(
    resolve &&
    String(resolve.type || "").toLowerCase() === "debrid" &&
    DebridProviders.isSupported(resolve.service) &&
    resolve.isCached === true
  );
}

function needsLocalDebridResolve(stream = {}) {
  return (
    !isDirectDebrid(stream) &&
    !getStreamUrl(stream) &&
    Boolean(stream.infoHash || torrentMagnetUri(stream))
  );
}

function stableFingerprint(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function trackerUrl(source) {
  const value = String(source || "").trim();
  if (!value || value.toLowerCase().startsWith("dht:")) {
    return null;
  }
  return value.replace(/^tracker:/i, "").trim() || null;
}

function buildMagnetUri(resolve = {}) {
  const existing = String(resolve.magnetUri || "").trim();
  if (existing) {
    return existing;
  }
  const hash = String(resolve.infoHash || "").trim();
  if (!hash) {
    return null;
  }
  const displayName = String(resolve.filename || resolve.torrentName || "").trim();
  const trackers = (Array.isArray(resolve.sources) ? resolve.sources : [])
    .map(trackerUrl)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  return `magnet:?xt=urn:btih:${encodeURIComponent(hash)}${displayName ? `&dn=${encodeURIComponent(displayName)}` : ""}${trackers.map((source) => `&tr=${encodeURIComponent(source)}`).join("")}`;
}

function buildLocalResolve(stream = {}, season, episode, providerId) {
  const magnet =
    torrentMagnetUri(stream) ||
    buildMagnetUri({
      infoHash: stream.infoHash,
      sources: stream.sources
    });
  if (!magnet) {
    return null;
  }
  return {
    type: "torrent",
    infoHash: stream.infoHash || null,
    fileIdx: stream.fileIdx ?? null,
    magnetUri: magnet,
    sources: Array.isArray(stream.sources) ? stream.sources : [],
    torrentName: stream.title || stream.name || null,
    filename: stream.behaviorHints?.filename || null,
    title: stream.title || stream.name || null,
    season,
    episode,
    service: providerId,
    isCached: stream.debridCacheStatus?.state === "CACHED"
  };
}

function getResolve(
  stream = {},
  season = null,
  episode = null,
  settings = DebridSettingsStore.get()
) {
  const directResolve = stream.clientResolve || stream.raw?.clientResolve || null;
  if (directResolve) {
    return directResolve;
  }
  if (!needsLocalDebridResolve(stream)) {
    return null;
  }
  const credential = DebridProviders.preferredResolverService(settings);
  if (
    !credential ||
    !DebridProviders.supports(credential.provider.id, DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE)
  ) {
    return null;
  }
  return buildLocalResolve(stream, season, episode, credential.provider.id);
}

function cacheKeyFor(
  stream = {},
  season = null,
  episode = null,
  settings = DebridSettingsStore.get()
) {
  const resolve = getResolve(stream, season, episode, settings);
  if (!resolve) {
    return null;
  }
  const provider = DebridProviders.byId(resolve.service);
  const apiKey = DebridProviders.apiKeyFor(settings, provider?.id);
  if (!provider || !apiKey) {
    return null;
  }
  const identity = resolve.infoHash || resolve.magnetUri || resolve.torrentName || resolve.filename;
  if (!identity) {
    return null;
  }
  return [
    provider.id,
    stableFingerprint(apiKey),
    String(identity).trim().toLowerCase(),
    String(resolve.fileIdx ?? ""),
    String(resolve.filename || stream.behaviorHints?.filename || "")
      .trim()
      .toLowerCase(),
    String(season ?? resolve.season ?? ""),
    String(episode ?? resolve.episode ?? "")
  ].join("|");
}

function cachedResult(cacheKey) {
  const entry = resolvedCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAtMs > RESOLVE_CACHE_TTL_MS) {
    resolvedCache.delete(cacheKey);
    return null;
  }
  return entry.result;
}

function rememberResolved(cacheKey, result) {
  resolvedCache.set(cacheKey, { result, cachedAtMs: Date.now() });
  while (resolvedCache.size > RESOLVE_CACHE_MAX_ENTRIES) {
    const oldestKey = resolvedCache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    resolvedCache.delete(oldestKey);
  }
}

function failure(status, detail = "") {
  return { status, detail };
}

function success(url, filename = null, videoSize = null) {
  return { status: "success", url, filename, videoSize };
}

function requestFailure(response, providerName, operation, bridge = false) {
  const httpStatus = Number(response?.status || 0);
  // A missing same-origin route is not evidence that a provider's file expired.
  const status = !httpStatus ? "network_error"
    : bridge && httpStatus === 404 && response.data?.error !== "provider_request_failed" ? "service_unavailable"
    : httpStatus === 401 || httpStatus === 403 ? "auth_failed"
    : httpStatus === 429 ? "rate_limited"
    : httpStatus >= 500 ? "service_degraded"
    : httpStatus === 404 ? "stale"
    : httpStatus === 409 && operation === "torrent/create" ? "not_cached"
    : "error";
  return failure(status, `${providerName} ${operation}: ${httpStatus ? `HTTP ${httpStatus}` : "no HTTP response"}.`);
}

export function debridResolveErrorMessage(result = {}) {
  const messages = {
    service_unavailable: "The website's debrid service is unavailable. Try again later or use a source with a direct playback link.",
    network_error: "Could not reach the debrid service. Check your connection and try again.",
    auth_failed: "The debrid service rejected the request. Check your debrid account and API key in Settings.",
    rate_limited: "Too many requests to the debrid service. Wait a moment and try again.",
    service_degraded: "The debrid service could not complete the request. Try again later or choose another source.",
    not_cached: "This file is not cached on your debrid service. Choose another source.",
    stale: "No playable file was found for this debrid source. Reload Sources or choose another source.",
    missing_api_key: "Connect your debrid account in Settings to play this source.",
    error: "Could not resolve this debrid source. Try again or choose another source."
  };
  const status = Object.hasOwn(messages, result.status) ? result.status : "error";
  return I18n.t(`debrid_resolve_${status}`, {}, { fallback: messages[status] });
}

async function resolveTorbox(resolve, apiKey, season, episode) {
  const magnet = buildMagnetUri(resolve);
  if (!magnet) {
    return failure("stale");
  }
  const create = await DebridApi.torboxCreateTorrent(apiKey, magnet);
  const torrentId = create.data?.data?.torrent_id ?? create.data?.data?.id;
  if (!create.ok || !torrentId) {
    return requestFailure(create, "TorBox", "torrent/create", true);
  }
  const torrent = await DebridApi.torboxGetTorrent(apiKey, torrentId);
  const files = torrent.data?.data?.files;
  if (!torrent.ok || !Array.isArray(files)) {
    return requestFailure(torrent, "TorBox", "torrent/lookup", true);
  }
  const file = selectDebridFile(files, resolve, { season, episode, kind: "torbox" });
  if (!file) {
    return failure("stale");
  }
  const link = await DebridApi.torboxRequestDownloadLink(apiKey, torrentId, file.id);
  const url = typeof link.data?.data === "string" ? link.data.data : "";
  if (!link.ok || !url) {
    return requestFailure(link, "TorBox", "link/resolve", true);
  }
  return success(url, getDebridFileDisplayName(file), getDebridFileSize(file));
}

async function resolvePremiumize(resolve, apiKey, season, episode, stream = {}) {
  const source = buildMagnetUri(resolve) || getStreamUrl(stream);
  if (!source) {
    return failure("stale");
  }
  const response = await DebridApi.premiumizeDirectDownload(apiKey, source);
  if (!response.ok) {
    return requestFailure(response, "Premiumize", "direct-download");
  }
  const body = response.data || {};
  if (String(body.status || "").toLowerCase() === "error") {
    const message = `${body.message || ""} ${body.code || ""}`.toLowerCase();
    return failure(
      message.includes("cache") || message.includes("not found") ? "not_cached" : "error"
    );
  }
  const file = selectDebridFile(body.content || [], resolve, {
    season,
    episode,
    kind: "premiumize"
  });
  const url = file?.link || "";
  if (!file || !url) {
    return failure("stale");
  }
  return success(
    url,
    getDebridFileDisplayName(file) || stream.behaviorHints?.filename || null,
    getDebridFileSize(file) || stream.behaviorHints?.videoSize || null
  );
}

async function resolveRealDebrid(resolve, apiKey, season, episode) {
  const magnet = buildMagnetUri(resolve);
  if (!magnet) {
    return failure("stale");
  }
  const add = await DebridApi.realDebridAddMagnet(apiKey, magnet);
  const torrentId = add.data?.id;
  if (!add.ok || !torrentId) {
    return requestFailure(add, "Real-Debrid", "add-magnet");
  }
  let resolved = false;
  try {
    const infoBefore = await DebridApi.realDebridTorrentInfo(apiKey, torrentId);
    const files = infoBefore.data?.files;
    if (!infoBefore.ok || !Array.isArray(files)) {
      return requestFailure(infoBefore, "Real-Debrid", "torrent-info");
    }
    const file = selectDebridFile(files, resolve, { season, episode, kind: "realdebrid" });
    if (file?.id == null) {
      return failure("stale");
    }
    const select = await DebridApi.realDebridSelectFiles(apiKey, torrentId, String(file.id));
    if (!select.ok && select.status !== 202) {
      return requestFailure(select, "Real-Debrid", "select-files");
    }
    const infoAfter = await DebridApi.realDebridTorrentInfo(apiKey, torrentId);
    if (!infoAfter.ok) {
      return requestFailure(infoAfter, "Real-Debrid", "torrent-info");
    }
    if (String(infoAfter.data?.status || "").toLowerCase() !== "downloaded") {
      return failure("stale");
    }
    const link = (Array.isArray(infoAfter.data?.links) ? infoAfter.data.links : []).find(Boolean);
    if (!link) {
      return failure("stale");
    }
    const unrestricted = await DebridApi.realDebridUnrestrictLink(apiKey, link);
    const url = unrestricted.data?.download || "";
    if (!unrestricted.ok || !url) {
      return requestFailure(unrestricted, "Real-Debrid", "unrestrict-link");
    }
    resolved = true;
    return success(
      url,
      unrestricted.data?.filename || getDebridFileDisplayName(file),
      unrestricted.data?.filesize || getDebridFileSize(file)
    );
  } finally {
    if (!resolved) {
      DebridApi.realDebridDeleteTorrent(apiKey, torrentId).catch(() => null);
    }
  }
}

async function getLocalTorrentCacheStatus(provider, apiKey, hash) {
  const normalized = String(hash || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { status: "unknown" };
  }
  if (provider.id === DEBRID_PROVIDER_IDS.TORBOX) {
    const response = await DebridApi.torboxCheckCached(apiKey, [normalized]);
    if (!response.ok || response.data?.success === false || !response.data?.data || typeof response.data.data !== "object") {
      return requestFailure(response, "TorBox", "cache/check", true);
    }
    return { status: "success", cached: Boolean(response.data?.data?.[normalized]) };
  }
  if (provider.id === DEBRID_PROVIDER_IDS.PREMIUMIZE) {
    const response = await DebridApi.premiumizeCheckCache(apiKey, [normalized]);
    if (!response.ok || String(response.data?.status || "").toLowerCase() === "error") {
      return requestFailure(response, "Premiumize", "cache/check");
    }
    return { status: "success", cached: response.data?.response?.[0] === true };
  }
  return { status: "unknown" };
}

function withResolvedUrl(stream = {}, result) {
  return {
    ...stream,
    url: result.url,
    externalUrl: null,
    behaviorHints: {
      ...(stream.behaviorHints || {}),
      filename: result.filename || stream.behaviorHints?.filename || null,
      videoSize: result.videoSize || stream.behaviorHints?.videoSize || null
    },
    raw: {
      ...(stream.raw || stream),
      url: result.url,
      externalUrl: null,
      behaviorHints: {
        ...(stream.raw?.behaviorHints || stream.behaviorHints || {}),
        filename: result.filename || stream.behaviorHints?.filename || null,
        videoSize: result.videoSize || stream.behaviorHints?.videoSize || null
      }
    }
  };
}

export const DirectDebridResolver = {
  canResolveStream(stream = {}, { season = null, episode = null } = {}) {
    const settings = DebridSettingsStore.get();
    if (!settings.enabled) {
      return false;
    }
    const resolve = getResolve(stream, season, episode, settings);
    if (!resolve) {
      return false;
    }
    const provider = DebridProviders.byId(resolve.service);
    if (!provider) {
      return false;
    }
    const activeProvider = DebridProviders.preferredResolverService(settings)?.provider || null;
    if (isDirectDebrid(stream) && activeProvider?.id && provider.id !== activeProvider.id) {
      return false;
    }
    if (
      needsLocalDebridResolve(stream) &&
      !provider.capabilities.includes(DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE)
    ) {
      return false;
    }
    if (needsLocalDebridResolve(stream) && stream.debridCacheStatus?.state === "NOT_CACHED") {
      return false;
    }
    return Boolean(DebridProviders.apiKeyFor(settings, provider.id));
  },

  shouldListStream(stream = {}) {
    if (getStreamUrl(stream) || stream.ytId) {
      return true;
    }
    const settings = DebridSettingsStore.get();
    // Resolve playable links is opt-in. With it off, retain ordinary addon
    // torrent results instead of making native debrid resolution a display prerequisite.
    if (!settings.enabled) {
      return Boolean(stream.infoHash || torrentMagnetUri(stream));
    }
    return this.canResolveStream(stream);
  },

  cachedPlayableStream(stream = {}, { season = null, episode = null } = {}) {
    const key = cacheKeyFor(stream, season, episode);
    const cached = key ? cachedResult(key) : null;
    return cached ? withResolvedUrl(stream, cached) : null;
  },

  async resolve(stream = {}, { season = null, episode = null } = {}) {
    if (getStreamUrl(stream)) {
      return { status: "success", stream };
    }
    const settings = DebridSettingsStore.get();
    if (!settings.enabled) {
      return failure("disabled");
    }
    const resolve = getResolve(stream, season, episode, settings);
    if (!resolve) {
      return failure("stale");
    }
    const provider = DebridProviders.byId(resolve.service);
    const apiKey = DebridProviders.apiKeyFor(settings, provider?.id);
    if (!provider || !apiKey) {
      return failure("missing_api_key");
    }
    const activeProvider = DebridProviders.preferredResolverService(settings)?.provider || null;
    if (isDirectDebrid(stream) && activeProvider?.id && provider.id !== activeProvider.id) {
      return failure("stale");
    }
    if (needsLocalDebridResolve(stream) && stream.debridCacheStatus?.state === "NOT_CACHED") {
      return failure("not_cached");
    }
    if (
      needsLocalDebridResolve(stream) &&
      stream.infoHash &&
      stream.debridCacheStatus?.state !== "CACHED" &&
      provider.capabilities.includes(DEBRID_CAPABILITIES.LOCAL_TORRENT_CACHE_CHECK)
    ) {
      const cacheStatus = await getLocalTorrentCacheStatus(provider, apiKey, stream.infoHash).catch(
        (error) => failure("error", error?.message || "")
      );
      if (cacheStatus?.status !== "success" && cacheStatus?.status !== "unknown") {
        return cacheStatus;
      }
      if (cacheStatus?.status === "success" && cacheStatus.cached === false) {
        return failure("not_cached");
      }
    }

    const key = cacheKeyFor(stream, season, episode, settings);
    if (key) {
      const cached = cachedResult(key);
      if (cached) {
        return { status: "success", stream: withResolvedUrl(stream, cached) };
      }
      const inFlight = inFlightResolves.get(key);
      if (inFlight) {
        const result = await inFlight;
        return result.status === "success"
          ? { status: "success", stream: withResolvedUrl(stream, result) }
          : result;
      }
    }

    const task = (async () => {
      switch (provider.id) {
        case DEBRID_PROVIDER_IDS.TORBOX:
          return resolveTorbox(resolve, apiKey, season, episode);
        case DEBRID_PROVIDER_IDS.PREMIUMIZE:
          return resolvePremiumize(resolve, apiKey, season, episode, stream);
        case DEBRID_PROVIDER_IDS.REAL_DEBRID:
          return resolveRealDebrid(resolve, apiKey, season, episode);
        default:
          return failure("error");
      }
    })();

    if (key) {
      inFlightResolves.set(key, task);
    }
    try {
      const result = await task;
      if (key && result.status === "success") {
        rememberResolved(key, result);
      }
      return result.status === "success"
        ? { status: "success", stream: withResolvedUrl(stream, result) }
        : result;
    } catch (error) {
      return failure("error", error?.message || "");
    } finally {
      if (key && inFlightResolves.get(key) === task) {
        inFlightResolves.delete(key);
      }
    }
  }
};
