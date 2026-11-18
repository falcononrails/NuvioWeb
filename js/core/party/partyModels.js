// Watch party data model, mirroring Android core/party/PartyModels.kt.
// Wire objects keep the server's snake_case field names.

export const PARTY_CODE_LENGTH = 6;
export const PARTY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const PartyMemberStatus = Object.freeze({
  Browsing: "browsing",
  Loading: "loading",
  Buffering: "buffering",
  Ready: "ready",
  Behind: "behind"
});

export const PartyError = Object.freeze({
  NotFound: "NotFound",
  Full: "Full",
  Removed: "Removed",
  Ended: "Ended",
  RateLimited: "RateLimited",
  SignInRequired: "SignInRequired",
  Unavailable: "Unavailable",
  Network: "Network"
});

export const PartyAction = Object.freeze({
  Paused: "Paused",
  Resumed: "Resumed",
  Seeked: "Seeked",
  Speed: "Speed"
});

export const PartyEventType = Object.freeze({
  MemberJoined: "MemberJoined",
  MemberLeft: "MemberLeft",
  Removed: "Removed",
  Ended: "Ended",
  MediaChanged: "MediaChanged",
  ControlChanged: "ControlChanged"
});

const MEMBER_STATUSES = new Set(Object.values(PartyMemberStatus));
const SHAREABLE_URL = /^https?:\/\/(?!localhost|127\.|0\.0\.0\.0|\[::1\])[^\s/]+/i;

export function normalizePartyCode(input) {
  return String(input ?? "")
    .toUpperCase()
    .split("")
    .filter((character) => PARTY_CODE_ALPHABET.includes(character))
    .join("");
}

export function isValidPartyCode(input) {
  return normalizePartyCode(input).length === PARTY_CODE_LENGTH;
}

export function formatPartyCode(code) {
  const normalized = normalizePartyCode(code);
  return normalized.length === PARTY_CODE_LENGTH
    ? `${normalized.slice(0, 3)} ${normalized.slice(3)}`
    : normalized;
}

export function partyMediaKey(metaType, metaId, season, episode) {
  return [
    String(metaType ?? "").toLowerCase(),
    String(metaId ?? ""),
    season == null ? "" : String(season),
    episode == null ? "" : String(episode)
  ].join("|");
}

export function mediaKeyOf(media) {
  return media ? partyMediaKey(media.meta_type, media.meta_id, media.season, media.episode) : "";
}

export function isShareableStreamUrl(url) {
  return SHAREABLE_URL.test(String(url ?? ""));
}

export function partyErrorOf(code) {
  if (code == null) return null;
  switch (code) {
    case "party_not_found":
      return PartyError.NotFound;
    case "party_full":
      return PartyError.Full;
    case "removed":
    case "not_member":
      return PartyError.Removed;
    case "party_ended":
      return PartyError.Ended;
    case "rate_limited":
      return PartyError.RateLimited;
    case "unavailable":
      return PartyError.Unavailable;
    default:
      return PartyError.Network;
  }
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value) {
  return typeof value === "string" ? value : null;
}

function optionalInt(value) {
  return Number.isInteger(value) ? value : null;
}

function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringMap(value) {
  if (!isObject(value)) return {};
  const result = {};
  Object.keys(value).forEach((key) => {
    if (typeof value[key] === "string") result[key] = value[key];
  });
  return result;
}

export function decodePartySource(value) {
  if (!isObject(value)) return null;
  return {
    info_hash: optionalString(value.info_hash),
    file_idx: optionalInt(value.file_idx),
    filename: optionalString(value.filename),
    video_size: optionalNumber(value.video_size),
    binge_group: optionalString(value.binge_group),
    addon_id: optionalString(value.addon_id),
    name: optionalString(value.name)
  };
}

export function decodePartyMedia(value) {
  if (!isObject(value)) return null;
  if (
    typeof value.type !== "string" ||
    typeof value.meta_id !== "string" ||
    typeof value.meta_type !== "string"
  )
    return null;
  return {
    type: value.type,
    meta_id: value.meta_id,
    meta_type: value.meta_type,
    video_id: optionalString(value.video_id),
    season: optionalInt(value.season),
    episode: optionalInt(value.episode),
    title: typeof value.title === "string" ? value.title : "",
    episode_title: optionalString(value.episode_title),
    description: optionalString(value.description),
    poster: optionalString(value.poster),
    background: optionalString(value.background),
    logo: optionalString(value.logo),
    source: decodePartySource(value.source)
  };
}

export function decodePartyPlayback(value) {
  if (!isObject(value)) return null;
  const seq = optionalNumber(value.seq);
  const positionMs = optionalNumber(value.position_ms);
  const at = optionalNumber(value.at);
  if (seq == null || positionMs == null || at == null || typeof value.paused !== "boolean")
    return null;
  return {
    seq: Math.trunc(seq),
    member_id: optionalString(value.member_id),
    paused: value.paused,
    position_ms: Math.trunc(positionMs),
    rate: optionalNumber(value.rate) ?? 1,
    at: Math.trunc(at),
    media_key: optionalString(value.media_key),
    waiting: value.waiting === true
  };
}

export function decodePartyMember(value) {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.display_name !== "string")
    return null;
  return {
    id: value.id,
    display_name: value.display_name,
    avatar_url: optionalString(value.avatar_url),
    avatar_color: optionalString(value.avatar_color)
  };
}

export function decodePartyPresence(value) {
  if (!isObject(value) || typeof value.member_id !== "string") return null;
  const status = MEMBER_STATUSES.has(value.status)
    ? value.status
    : value.status == null
      ? PartyMemberStatus.Browsing
      : null;
  if (status == null) return null;
  const behind = optionalNumber(value.behind_ms);
  return {
    member_id: value.member_id,
    status,
    media_key: optionalString(value.media_key),
    behind_ms: behind == null ? null : Math.trunc(behind)
  };
}

export function decodePartyPreview(value) {
  const source = isObject(value) ? value : {};
  return {
    media: decodePartyMedia(source.media),
    host: decodePartyMember(source.host),
    members: optionalInt(source.members) ?? 0,
    max_members: optionalInt(source.max_members) ?? 0,
    error: optionalString(source.error)
  };
}

export function isPartyPreviewFull(preview) {
  const max = Number(preview?.max_members || 0);
  return max >= 1 && Number(preview?.members || 0) >= max;
}

export function decodePartySnapshot(value) {
  const source = isObject(value) ? value : {};
  let party = null;
  if (isObject(source.party)) {
    const media = decodePartyMedia(source.party.media);
    if (typeof source.party.id === "string" && typeof source.party.code === "string" && media) {
      party = {
        id: source.party.id,
        code: source.party.code,
        host_member_id: optionalString(source.party.host_member_id),
        host_only: source.party.host_only === true,
        media,
        playback: decodePartyPlayback(source.party.playback),
        max_members: optionalInt(source.party.max_members) ?? 3
      };
    }
  }
  return {
    party,
    members: Array.isArray(source.members)
      ? source.members.map(decodePartyMember).filter(Boolean)
      : [],
    member_id: optionalString(source.member_id),
    server_time_ms: optionalNumber(source.server_time_ms),
    error: optionalString(source.error),
    ok: typeof source.ok === "boolean" ? source.ok : null
  };
}

export function decodePartyStream(value) {
  if (!isObject(value) || typeof value.media_key !== "string" || typeof value.url !== "string")
    return null;
  return {
    media_key: value.media_key,
    url: value.url,
    headers: stringMap(value.headers),
    response_headers: stringMap(value.response_headers),
    name: optionalString(value.name),
    description: optionalString(value.description),
    addon_name: typeof value.addon_name === "string" ? value.addon_name : "",
    addon_id: typeof value.addon_id === "string" ? value.addon_id : "",
    addon_logo: optionalString(value.addon_logo),
    filename: optionalString(value.filename),
    video_size: optionalNumber(value.video_size),
    binge_group: optionalString(value.binge_group),
    stream_type: optionalString(value.stream_type),
    badges: Array.isArray(value.badges)
      ? value.badges
          .filter((badge) => isObject(badge) && typeof badge.name === "string")
          .map((badge) => ({
            ...badge,
            imageURL: typeof badge.imageURL === "string" ? badge.imageURL : ""
          }))
      : []
  };
}

export function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function isPartyHost(party) {
  return Boolean(party) && party.memberId === party.hostMemberId;
}

export function canControlParty(party) {
  return Boolean(party) && (!party.hostOnly || isPartyHost(party));
}

export function partyMember(party, id) {
  if (!party || id == null) return null;
  return party.members.find((member) => member.id === id) || null;
}

/** Android PartySourceMatch: torrent hash and file index, else the exact file name. */
export function partySourceMatches(source, stream) {
  if (!source || !stream) return false;
  const raw = stream.raw || {};
  const hints = { ...(raw.behaviorHints || {}), ...(stream.behaviorHints || {}) };
  const resolve = stream.clientResolve || raw.clientResolve || {};
  const hash = String(source.info_hash || "")
    .trim()
    .toLowerCase();
  const streamHash = String(stream.infoHash || raw.infoHash || resolve.infoHash || "")
    .trim()
    .toLowerCase();
  if (hash && streamHash) {
    const index = source.file_idx;
    const candidates = [stream.fileIdx, raw.fileIdx, resolve.fileIdx];
    const streamIndex = candidates.find(
      (value) => Number.isInteger(Number(value)) && value !== null && value !== ""
    );
    return (
      hash === streamHash &&
      (index == null || streamIndex == null || Number(index) === Number(streamIndex))
    );
  }
  const file = String(source.filename || "").trim();
  if (!file) return false;
  const streamFile = String(hints.filename || resolve.filename || "").trim();
  return Boolean(streamFile) && file.toLowerCase() === streamFile.toLowerCase();
}

/** Android PartyStream.toStream(): a stream entry the stream list and player understand. */
export function partyStreamToEntry(stream) {
  const proxyHeaders = { request: { ...stream.headers }, response: { ...stream.response_headers } };
  const behaviorHints = {
    bingeGroup: stream.binge_group,
    proxyHeaders,
    videoSize: stream.video_size,
    filename: stream.filename
  };
  const raw = {
    name: stream.name,
    description: stream.description,
    url: stream.url,
    behaviorHints,
    addonName: stream.addon_name,
    addonLogo: stream.addon_logo,
    badges: stream.badges,
    partyShared: true
  };
  return {
    id: `party-shared:${stream.media_key}:${stream.url}`,
    name: stream.name,
    title: null,
    description: stream.description,
    url: stream.url,
    ytId: null,
    infoHash: null,
    fileIdx: null,
    engineFs: null,
    externalUrl: null,
    behaviorHints,
    sources: [],
    quality: null,
    qualityValue: -1,
    clientResolve: null,
    debridCacheStatus: null,
    streamPresentation: null,
    subtitles: [],
    addonId: stream.addon_id || null,
    addonBaseUrl: null,
    addonName: stream.addon_name,
    addonLogo: stream.addon_logo,
    sourceProviderId: null,
    streamOrigin: { kind: "party", addonId: stream.addon_id || null, addonName: stream.addon_name },
    addonOrderIndex: -1,
    mimeType: null,
    sourceType: "",
    badges: stream.badges,
    partyShared: true,
    raw
  };
}

export function isPartySharedStream(candidate) {
  return Boolean(candidate?.partyShared || candidate?.raw?.partyShared);
}

/** Android encodes party objects with explicitNulls = false: null fields are left out. */
export function compactJson(value) {
  if (Array.isArray(value)) return value.map(compactJson);
  if (!isObject(value)) return value;
  const result = {};
  Object.keys(value).forEach((key) => {
    if (value[key] !== null && value[key] !== undefined) result[key] = compactJson(value[key]);
  });
  return result;
}
