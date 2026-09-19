import { createExternalReturnServer } from "./bridge.mjs";
import { createEpisodeStore } from "./episodes.mjs";
import webpush from "web-push";

const port = Math.max(1, Number(process.env.PORT || 8080) || 8080);
const episodeStore = createEpisodeStore({ file: process.env.NUVIO_NOTIFICATIONS_FILE || "/data/episodes.json" });
const server = createExternalReturnServer({ episodeStore });
server.requestTimeout = 15000;
server.headersTimeout = 10000;
if (process.env.NUVIO_WEB_PUSH_PRIVATE_KEY && process.env.NUVIO_WEB_PUSH_PUBLIC_KEY && process.env.NUVIO_WEB_PUSH_SUBJECT) {
  webpush.setVapidDetails(process.env.NUVIO_WEB_PUSH_SUBJECT, process.env.NUVIO_WEB_PUSH_PUBLIC_KEY, process.env.NUVIO_WEB_PUSH_PRIVATE_KEY);
  let sending = false;
  const tick = async () => {
    if (sending) return;
    sending = true;
    try { await episodeStore.deliver((subscription, payload) => webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 86400, timeout: 10000 })); }
    catch { console.error("Couldn't persist episode notification state."); }
    finally { sending = false; }
  };
  setInterval(tick, 60000).unref();
  void tick();
}

server.listen(port, "0.0.0.0", () => {
  console.log(`External return bridge listening on ${port}`);
});
