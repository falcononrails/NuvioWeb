import { PartyRepository } from "../../../core/party/partyRepository.js";
import { isPartyHost, mediaKeyOf, PartyEventType, PartyMemberStatus } from "../../../core/party/partyModels.js";
import { PartySync } from "../../../core/party/partySync.js";
import { openPartyMedia } from "./watchPartyDialog.js";

const SYNC_INTERVAL_MS = 500;
const SEEK_RETRY_MS = 1500;

export function playerPartyMedia(params) {
  const itemType = params?.itemType === "tv" ? "series" : params?.itemType;
  if (!params?.itemId || !["movie", "series"].includes(itemType)) return null;
  const season = params.season == null ? null : Number(params.season);
  const episode = params.episode == null ? null : Number(params.episode);
  if (itemType === "series" && (!Number.isInteger(season) || !Number.isInteger(episode))) return null;
  return {
    type: itemType,
    meta_type: itemType,
    meta_id: String(params.itemId),
    video_id: params.videoId ? String(params.videoId) : null,
    season,
    episode,
    title: String(params.playerTitle || params.itemTitle || "").slice(0, 250),
    episode_title: String(params.playerEpisodeTitle || "").slice(0, 250) || null
  };
}

export function isFollowingParty(params, party = PartyRepository.getState().party) {
  return Boolean(party?.mediaKey && !isPartyHost(party) && party.mediaKey === mediaKeyOf(playerPartyMedia(params)));
}

export function bindPartyPlayback(screen, controller, repository = PartyRepository, {
  openMedia = openPartyMedia,
  schedule = setInterval,
  cancel = clearInterval,
  now = () => performance.now()
} = {}) {
  const video = controller.video;
  if (!video) return () => {};
  let timer = null;
  let lastSeek = -Infinity;
  let lastMediaKey = "";
  let following = false;
  let busy = false;
  let rateChanged = false;
  let previousRate = 1;

  function media() {
    return playerPartyMedia(screen.params);
  }

  function playbackStatus() {
    if (video.ended) return PartyMemberStatus.Browsing;
    if (screen.loadingVisible || video.readyState < 2) return PartyMemberStatus.Loading;
    return video.seeking ? PartyMemberStatus.Buffering : PartyMemberStatus.Ready;
  }

  function publish() {
    const party = repository.getState().party;
    const key = mediaKeyOf(media());
    if (!key || !isPartyHost(party) || party.mediaKey !== key || video.readyState < 2 ||
        video.ended || screen.loadingVisible || screen.startupAudioGateActive) return;
    const position = controller.getCurrentTimeSeconds() * 1000;
    const rate = controller.getPlaybackRate();
    const previous = repository.getPlayback();
    if (previous && previous.media_key === key && previous.paused === video.paused && previous.rate === rate &&
        Math.abs(position - PartySync.expectedPositionMs(previous, repository.nowMs())) < 500) return;
    repository.publishPlayback(video.paused, position, rate);
  }

  async function sync() {
    if (busy) return;
    const { party } = repository.getState();
    const currentMedia = media();
    const key = mediaKeyOf(currentMedia);
    if (!party || !key) return;
    busy = true;
    try {
      if (key !== lastMediaKey) {
        lastMediaKey = key;
        lastSeek = -Infinity;
      }
      if (isPartyHost(party) && party.mediaKey !== key && video.readyState >= 2 &&
          !screen.loadingVisible && !video.ended &&
          String(controller.currentItemId) === currentMedia.meta_id &&
          (controller.currentVideoId || null) === currentMedia.video_id) {
        await repository.publishMedia(currentMedia, controller.getCurrentTimeSeconds() * 1000);
        publish();
        return;
      }
      if (party.mediaKey !== key) return;
      repository.setLocalStatus(playbackStatus(), key);
      if (isPartyHost(party)) {
        if (!repository.getPlayback()) publish();
        return;
      }
      const playback = repository.getPlayback();
      if (!playback || playback.media_key && playback.media_key !== key ||
          video.readyState < 2 || video.seeking || video.ended ||
          screen.loadingVisible || screen.startupAudioGateActive) return;
      const duration = controller.getDurationSeconds() * 1000;
      const position = controller.getCurrentTimeSeconds() * 1000;
      const target = PartySync.expectedPositionMs(playback, repository.nowMs(), duration);
      if (!following) {
        following = true;
        previousRate = controller.getPlaybackRate();
      }
      if (Math.abs(position - target) > (playback.paused ? 500 : 2000) && now() - lastSeek >= SEEK_RETRY_MS) {
        lastSeek = now();
        controller.seekToSeconds(Math.min(target, duration > 0 ? Math.max(0, duration - 100) : target) / 1000);
      }
      if (playback.paused !== video.paused) {
        if (playback.paused) controller.pause();
        else controller.resume();
      }
      if (controller.getSupportedPlaybackRates().includes(playback.rate) &&
          Math.abs(playback.rate - controller.getPlaybackRate()) > 0.01) {
        rateChanged = (await controller.setPlaybackRate(playback.rate)) || rateChanged;
      }
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (timer != null) cancel(timer);
    timer = null;
    if (rateChanged) void controller.setPlaybackRate(previousRate);
    following = rateChanged = false;
  }

  function update() {
    if (!repository.getState().party) stop();
    else if (timer == null) timer = schedule(() => void sync().catch(() => {}), SYNC_INTERVAL_MS);
  }

  const unsubscribeState = repository.subscribeState(update);
  const unsubscribeEvents = repository.subscribeEvents((event) => {
    const { party } = repository.getState();
    if (event.type === PartyEventType.MediaChanged && party && !isPartyHost(party) &&
        mediaKeyOf(event.media) !== mediaKeyOf(media())) {
      void openMedia(event.media);
    }
  });
  const events = ["playing", "pause", "seeked", "ratechange"];
  for (const event of events) video.addEventListener(event, publish);
  update();

  return () => {
    stop();
    unsubscribeState();
    unsubscribeEvents();
    for (const event of events) video.removeEventListener(event, publish);
    if (repository.getState().party) repository.setLocalStatus(PartyMemberStatus.Browsing, null);
  };
}
