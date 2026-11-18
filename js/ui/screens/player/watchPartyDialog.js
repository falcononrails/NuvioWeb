import { AuthManager } from "../../../core/auth/authManager.js";
import { PartyRepository } from "../../../core/party/partyRepository.js";
import { formatPartyCode, isPartyHost, isValidPartyCode, normalizePartyCode, PartyError } from "../../../core/party/partyModels.js";
import { Router } from "../../navigation/router.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";

const partyErrors = {
  [PartyError.NotFound]: "No party found for that code.",
  [PartyError.Full]: "This party is full.",
  [PartyError.Removed]: "You were removed from this party.",
  [PartyError.Ended]: "This party has ended.",
  [PartyError.RateLimited]: "Too many attempts. Try again shortly.",
  [PartyError.SignInRequired]: "Sign in to join a watch party.",
  [PartyError.Unavailable]: "Watch parties are unavailable on this server.",
  [PartyError.Network]: "Unable to reach the watch party. Try again."
};

export function partyCodeFromInput(value) {
  const input = String(value ?? "").trim();
  if (/^https?:\/\//i.test(input)) {
    try {
      const link = new URL(input);
      if (link.origin !== "https://nuvio.tv") return "";
      return normalizePartyCode(link.pathname.match(/^\/party\/([^/]+)\/?$/)?.[1]);
    } catch {
      return "";
    }
  }
  return normalizePartyCode(input);
}

export function partyStreamParams(media) {
  if (!media?.meta_id || !["movie", "series"].includes(media.meta_type)) return null;
  if (media.meta_type === "series" && !media.video_id && (media.season == null || media.episode == null)) {
    return null;
  }
  return {
    itemId: media.meta_id,
    itemType: media.meta_type,
    videoId: media.video_id || (media.meta_type === "series"
      ? `${media.meta_id}:${media.season}:${media.episode}`
      : media.meta_id),
    itemTitle: media.title,
    episodeTitle: media.episode_title || "",
    season: media.season,
    episode: media.episode,
    startFromBeginning: true,
    manualSelection: true
  };
}

export function openPartyMedia(media) {
  const params = partyStreamParams(media);
  if (!params) return false;
  const replacingPlayer = Router.getCurrent() === "player";
  return Router.navigate("stream", params, replacingPlayer ? { replaceHistory: true, skipStackPush: true } : {});
}

export function openWatchPartyDialog({ media = null, onHosted = null, onClose = null } = {}) {
  const content = document.createElement("div");
  content.className = "watch-party-dialog-content";
  content.innerHTML = `
    <p class="nuvio-dialog-subtitle" data-party-status role="status"></p>
    <form data-party-join>
      <label>Room code or Nuvio invite link <input class="watch-party-code" type="text" dir="ltr" maxlength="120"
        autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
      <div class="nuvio-dialog-actions watch-party-actions">
        <button type="submit" class="nuvio-dialog-button">Join party</button>
        ${media ? '<button type="button" class="nuvio-dialog-button" data-party-host>Start party</button>' : ""}
      </div>
    </form>
    <div class="nuvio-dialog-actions watch-party-actions" data-party-room hidden>
      <button type="button" class="nuvio-dialog-button" data-party-source>Choose source</button>
      <button type="button" class="nuvio-dialog-button" data-party-copy>Copy code</button>
      <button type="button" class="nuvio-dialog-button" data-party-leave>Leave party</button>
    </div>`;
  const status = content.querySelector("[data-party-status]");
  const form = content.querySelector("[data-party-join]");
  const input = form.querySelector("input");
  const room = content.querySelector("[data-party-room]");
  const source = content.querySelector("[data-party-source]");
  const leave = content.querySelector("[data-party-leave]");
  let busy = false;
  let closed = false;

  function refresh() {
    if (closed) return;
    const { party } = PartyRepository.getState();
    form.hidden = Boolean(party);
    room.hidden = !party;
    source.hidden = !partyStreamParams(party?.media);
    leave.textContent = isPartyHost(party) ? "End party" : "Leave party";
    for (const button of content.querySelectorAll("button")) button.disabled = busy;
    if (party) {
      const count = party.members.length;
      const title = party.media?.title ? ` · ${party.media.title}` : "";
      status.textContent = `${formatPartyCode(party.code)} · ${count} ${count === 1 ? "member" : "members"}${title}${party.connected ? "" : " · Connecting…"}`;
    } else {
      status.textContent = media
        ? "Start a room for this title, or enter a code to join friends."
        : "Enter the room code from a friend. You’ll choose your own playback source after joining.";
    }
  }

  async function run(action) {
    if (busy || closed) return;
    busy = true;
    refresh();
    let message;
    try {
      message = await action();
    } catch {
      message = partyErrors[PartyError.Network];
    } finally {
      busy = false;
      refresh();
      if (message && !closed) status.textContent = message;
    }
  }

  async function available() {
    if (!AuthManager.isAuthenticated) return PartyError.SignInRequired;
    await PartyRepository.refreshAvailability();
    return PartyRepository.canUse() ? null : PartyError.Unavailable;
  }

  const dialog = new NuvioDialog({
    title: "Watch party",
    content,
    onDismiss: close,
    buttons: [{ label: "Close", key: "close", onAction: close }]
  }).mount(document.fullscreenElement || document.body);
  const unsubscribe = PartyRepository.subscribeState(refresh);

  function close() {
    if (closed) return;
    closed = true;
    unsubscribe();
    dialog.destroy();
    onClose?.();
  }

  refresh();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = partyCodeFromInput(input.value);
    if (!isValidPartyCode(code)) {
      status.textContent = "Enter a valid six-character room code or Nuvio invite link.";
      input.focus();
      return;
    }
    void run(async () => {
      const gate = await available();
      if (closed) return;
      const error = gate || await PartyRepository.join(code);
      if (error) return partyErrors[error] || partyErrors[PartyError.Network];
      if (closed) await PartyRepository.leave();
    });
  });
  form.querySelector("[data-party-host]")?.addEventListener("click", () => void run(async () => {
    const gate = await available();
    if (closed) return;
    const error = gate || await PartyRepository.create(media);
    if (error) return partyErrors[error] || partyErrors[PartyError.Network];
    if (closed) {
      await PartyRepository.end();
      return;
    }
    await PartyRepository.setHostOnly(true);
    if (!closed) onHosted?.();
  }));
  source.addEventListener("click", () => {
    const party = PartyRepository.getState().party;
    void openPartyMedia(party?.media);
    close();
  });
  content.querySelector("[data-party-copy]").addEventListener("click", () => void run(async () => {
    const party = PartyRepository.getState().party;
    if (!party) return;
    await navigator.clipboard.writeText(party.code);
    return `Room code ${formatPartyCode(party.code)} copied.`;
  }));
  leave.addEventListener("click", () => void run(async () => {
    if (isPartyHost(PartyRepository.getState().party)) await PartyRepository.end();
    else await PartyRepository.leave();
  }));

  return { destroy: close };
}
