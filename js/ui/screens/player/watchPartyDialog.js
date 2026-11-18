import { AuthManager } from "../../../core/auth/authManager.js";
import { PARTY_CHAT_MAX_LENGTH, PartyRepository } from "../../../core/party/partyRepository.js";
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

export function openWatchPartyDialog({ media = null, inPlayer = false, onHosted = null, onClose = null } = {}) {
  const opener = document.activeElement;
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
    </div>
    ${inPlayer ? `<section class="watch-party-chat" aria-label="Party chat" hidden>
      <h3>Party chat</h3>
      <div class="watch-party-chat-log" role="log" aria-label="Messages" tabindex="0"></div>
      <p class="nuvio-dialog-subtitle" data-chat-status role="status"></p>
      <form class="watch-party-chat-compose">
        <input class="watch-party-code" type="text" aria-label="Message" placeholder="Write a message"
          maxlength="${PARTY_CHAT_MAX_LENGTH}" autocomplete="off" required>
        <button type="submit" class="nuvio-dialog-button">Send</button>
      </form>
    </section>` : ""}`;
  const status = content.querySelector("[data-party-status]");
  const form = content.querySelector("[data-party-join]");
  const input = form.querySelector("input");
  const room = content.querySelector("[data-party-room]");
  const source = content.querySelector("[data-party-source]");
  const leave = content.querySelector("[data-party-leave]");
  const chat = content.querySelector(".watch-party-chat");
  const chatLog = chat?.querySelector('[role="log"]');
  const chatStatus = chat?.querySelector("[data-chat-status]");
  const chatForm = chat?.querySelector("form");
  const chatInput = chatForm?.querySelector("input");
  const send = chatForm?.querySelector("button");
  let chatRoomId = null;
  let renderedMessages = null;
  let pendingMessage = null;
  let sending = false;
  let sendFailed = false;
  let busy = false;
  let closed = false;

  function refreshChat() {
    const { party } = PartyRepository.getState();
    const roomId = party?.id ?? null;
    if (roomId !== chatRoomId) {
      chatRoomId = roomId;
      chatInput.value = "";
      pendingMessage = null;
      sending = false;
      sendFailed = false;
    }
    chat.hidden = !party;
    const { messages, loading, error } = PartyRepository.getChat();
    chatInput.readOnly = sending;
    send.disabled = busy || sending;
    if (messages !== renderedMessages) {
      renderedMessages = messages;
      const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 32;
      const next = new Set(messages.map((message) => String(message.id)));
      const existing = new Map(Array.from(chatLog.children, (row) => [row.dataset.messageId, row]));
      for (const [id, row] of existing) {
        if (!next.has(id)) row.remove();
      }
      let previous = null;
      for (const message of messages) {
        const id = String(message.id);
        let row = existing.get(id);
        if (!row) {
          row = document.createElement("p");
          row.dataset.messageId = id;
          const author = document.createElement("strong");
          author.textContent = message.name;
          row.append(author, ` ${message.body}`);
          chatLog.insertBefore(row, previous ? previous.nextSibling : chatLog.firstChild);
        }
        previous = row;
      }
      if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
    }
    const nextStatus = sendFailed
      ? "Message could not be sent. Press Send to retry."
      : error ? "Chat history could not load."
      : loading && !messages.length ? "Loading chat…"
      : !messages.length ? "No messages yet." : "";
    if (chatStatus.textContent !== nextStatus) chatStatus.textContent = nextStatus;
  }

  function refresh() {
    if (closed) return;
    const { party } = PartyRepository.getState();
    form.hidden = Boolean(party);
    room.hidden = !party;
    source.hidden = !partyStreamParams(party?.media);
    leave.textContent = isPartyHost(party) ? "End party" : "Leave party";
    for (const button of content.querySelectorAll("button")) button.disabled = busy;
    if (chat) refreshChat();
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
    widthVw: 94,
    panelClassName: inPlayer ? "watch-party-dialog-panel watch-party-player-panel" : "watch-party-dialog-panel",
    onDismiss: close,
    buttons: [{ label: "Close", key: "close", onAction: close }]
  }).mount(document.fullscreenElement || document.body);
  const unsubscribe = PartyRepository.subscribeState(refresh);
  const unsubscribeChat = chat && PartyRepository.subscribeChat(refreshChat);

  function close() {
    if (closed) return;
    closed = true;
    unsubscribe();
    unsubscribeChat?.();
    dialog.destroy();
    onClose?.();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }

  refresh();
  if (!form.hidden) input.focus({ preventScroll: true });
  if (chatRoomId) void PartyRepository.refreshChat();
  chatForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text || busy || sending || !chatRoomId) return;
    if (pendingMessage?.text !== text) {
      pendingMessage = { text, id: crypto.randomUUID().replaceAll("-", "").slice(0, 20) };
    }
    const message = pendingMessage;
    sending = true;
    sendFailed = false;
    refreshChat();
    const sent = await PartyRepository.sendChat(text, message.id);
    if (closed || pendingMessage !== message) return;
    sending = false;
    sendFailed = !sent;
    if (sent) {
      chatInput.value = "";
      pendingMessage = null;
    }
    refreshChat();
    chatInput.focus({ preventScroll: true });
  });
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
