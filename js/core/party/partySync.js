// Pure watch party sync rules, mirroring Android core/party/PartySync.kt.
import { PartyAction, PartyMemberStatus } from "./partyModels.js";

export const PartyCorrectionType = Object.freeze({
  InSync: "InSync",
  Seek: "Seek",
  Nudge: "Nudge"
});
export const OwnSeekType = Object.freeze({
  Behind: "Behind",
  CatchUp: "CatchUp",
  Blocked: "Blocked"
});

export const NUDGE_START_MS = 250;
export const NUDGE_STOP_MS = 80;
export const SEEK_THRESHOLD_MS = 1500;
export const PAUSED_TOLERANCE_MS = 500;
export const NUDGE_FACTOR = 0.05;
export const SEEK_NOTICE_MS = 2000;
export const REJOIN_GAP_MS = 2000;
export const BEHIND_STEP_MS = 5000;

export const PartySync = {
  expectedPositionMs(playback, nowMs, durationMs = 0) {
    let position;
    if (playback.paused) {
      position = playback.position_ms;
    } else {
      const elapsed = Math.max(0, nowMs - playback.at);
      position = playback.position_ms + Math.trunc(elapsed * playback.rate);
    }
    const clamped = Math.max(0, position);
    return durationMs > 0 ? Math.min(clamped, durationMs) : clamped;
  },

  isNewer(candidate, current) {
    if (!current) return true;
    if (candidate.seq !== current.seq) return candidate.seq > current.seq;
    return String(candidate.member_id ?? "") > String(current.member_id ?? "");
  },

  correction(localPositionMs, expectedPositionMs, playback, nudging) {
    const drift = localPositionMs - expectedPositionMs;
    const distance = Math.abs(drift);
    if (playback.paused) {
      return distance > PAUSED_TOLERANCE_MS
        ? { type: PartyCorrectionType.Seek, positionMs: expectedPositionMs }
        : { type: PartyCorrectionType.InSync };
    }
    const threshold = nudging ? NUDGE_STOP_MS : NUDGE_START_MS;
    if (distance > SEEK_THRESHOLD_MS)
      return { type: PartyCorrectionType.Seek, positionMs: expectedPositionMs };
    if (distance > threshold) {
      const factor = drift > 0 ? 1 - NUDGE_FACTOR : 1 + NUDGE_FACTOR;
      return { type: PartyCorrectionType.Nudge, rate: playback.rate * factor };
    }
    return { type: PartyCorrectionType.InSync };
  },

  coordinatorId(party) {
    const online = new Set([...Object.keys(party.presence || {}), party.memberId]);
    const host = party.hostMemberId;
    if (host != null && online.has(host)) return host;
    if (party.hostOnly) return host;
    return party.members.find((member) => online.has(member.id))?.id ?? party.memberId;
  },

  actionOf(previous, next) {
    if (!previous || previous.waiting || next.waiting) return null;
    if (previous.media_key !== next.media_key) return null;
    if (previous.paused !== next.paused)
      return next.paused ? PartyAction.Paused : PartyAction.Resumed;
    if (Math.abs(previous.rate - next.rate) > 0.01) return PartyAction.Speed;
    if (Math.abs(next.position_ms - this.expectedPositionMs(previous, next.at)) > SEEK_NOTICE_MS)
      return PartyAction.Seeked;
    return null;
  },

  ownSeek(targetMs, partyPositionMs, behind) {
    if (targetMs < partyPositionMs - REJOIN_GAP_MS)
      return { type: OwnSeekType.Behind, positionMs: targetMs };
    if (behind) return { type: OwnSeekType.CatchUp };
    return { type: OwnSeekType.Blocked };
  },

  shouldRejoin(gapMs, playing) {
    return playing && gapMs <= REJOIN_GAP_MS;
  },

  reportedGapMs(gapMs) {
    const rounded =
      Math.floor((Math.max(0, gapMs) + BEHIND_STEP_MS / 2) / BEHIND_STEP_MS) * BEHIND_STEP_MS;
    return Math.max(BEHIND_STEP_MS, rounded);
  },

  waitingMemberIds(party, ignored = new Set()) {
    const key = party.mediaKey;
    return Object.values(party.presence || {})
      .filter((presence) => presence.media_key === key)
      .filter(
        (presence) =>
          presence.status === PartyMemberStatus.Loading ||
          presence.status === PartyMemberStatus.Buffering
      )
      .map((presence) => presence.member_id)
      .filter((id) => !ignored.has(id));
  }
};
