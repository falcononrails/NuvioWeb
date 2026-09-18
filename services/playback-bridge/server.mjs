import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { mediaHeaders, openSource, validateSource, SourceReadError } from "./source.mjs";

const MAX_SESSIONS = 2;
const IDLE_MS = 90_000;
const MAX_AGE_MS = 4 * 3600_000;
const inputArgs = [
  "-protocol_whitelist",
  "http,tcp",
  "-format_whitelist",
  "matroska,webm,mov,mpegts,avi",
  "-analyzeduration",
  "5000000",
  "-probesize",
  "5000000"
];
const token = () => randomBytes(24).toString("hex");
const failure = (status, message) => Object.assign(new Error(message), { status });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

export function compatibleProbe(data) {
  const duration = Number(data.format?.duration);
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = (data.streams || []).filter((stream) => stream.codec_type === "audio").slice(0, 16);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AGE_MS / 1000)
    throw failure(422, "Choose a movie or episode shorter than four hours.");
  if (!video || !["h264", "hevc"].includes(video.codec_name))
    throw failure(422, "This source needs video conversion. Choose an H.264 source instead.");
  if (Number(data.format?.bit_rate) > 60_000_000)
    throw failure(
      422,
      "This source is too large for compatibility playback. Choose a smaller source."
    );
  if (!audio.length) throw failure(422, "This file has no audio track. Choose another source.");
  return {
    duration,
    videoCodec: video.codec_name,
    tracks: audio.map((stream) => ({
      index: stream.index,
      language: stream.tags?.language || "und",
      title: stream.tags?.title || "",
      default: Boolean(stream.disposition?.default),
      codec: stream.codec_name
    }))
  };
}

export function selectAudioTrack(tracks, preferredLanguages = []) {
  const language = (value) => {
    try { return new Intl.Locale(value).language; } catch { return "und"; }
  };
  for (const preferred of preferredLanguages) {
    const code = language(preferred);
    const match = code !== "und" && tracks.find(track => language(track.language) === code);
    if (match) return match.index;
  }
  return (tracks.find(track => track.default) || tracks[0]).index;
}

export async function verifyNuvioAccount(bearer, authUrl, apiKey) {
  // This is Nuvio's account check for both email and approved device sessions.
  const response = await fetch(authUrl + "/rest/v1/rpc/get_sync_owner", {
    method: "POST",
    headers: { Authorization: bearer, apikey: apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
    redirect: "error"
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw failure(401, "Nuvio could not verify this session. Please sign in again.");
    throw failure(503, "Nuvio session verification is temporarily unavailable. Try again shortly.");
  }
  const owner = await response.json();
  // Only inspect claims after Nuvio has verified the signed token. An unlinked
  // anonymous device has itself as owner and must not receive a playback slot.
  let claims;
  try { claims = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url")); } catch {}
  if (typeof owner !== "string" || !/^[a-f0-9-]{36}$/i.test(owner) ||
      claims?.role !== "authenticated" || !claims.sub ||
      (claims.is_anonymous && owner === claims.sub))
    throw failure(401, "Sign in to a Nuvio account first.");
  return { id: owner, role: "authenticated" };
}

export async function createPlaybackBridge({
  origin,
  authUrl,
  apiKey,
  root = "/tmp/nuvio-playback",
  authenticate
} = {}) {
  const sessions = new Map();
  const cookies = new Map();
  const authCache = new Map();
  const requests = new Map();
  const revision = await readFile(new URL("../../release.json", import.meta.url), "utf8").then(text => JSON.parse(text).commit).catch(() => null);
  await mkdir(root, { recursive: true });

  async function verify(req) {
    const bearer = req.headers.authorization || "";
    if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(bearer))
      throw failure(401, "Sign in to Nuvio to use compatibility playback.");
    const key = createHash("sha256").update(bearer).digest("hex");
    const cached = authCache.get(key);
    if (cached?.expires > Date.now()) return cached.user;
    let user;
    if (authenticate) user = await authenticate(bearer);
    else user = await verifyNuvioAccount(bearer, authUrl, apiKey);
    if (!user?.id || user.is_anonymous || user.role !== "authenticated")
      throw failure(401, "Sign in to a Nuvio account first.");
    authCache.set(key, { user: user.id, expires: Date.now() + 60_000 });
    return user.id;
  }

  function cookieOwner(req) {
    const value = /(?:^|;\s*)nuvio_media=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || "")?.[1];
    const cookie = cookies.get(value);
    return cookie?.expires > Date.now() ? cookie.user : null;
  }

  function setCookie(req, res, user) {
    const previous = /(?:^|;\s*)nuvio_media=([a-f0-9]{48})(?:;|$)/.exec(
      req.headers.cookie || ""
    )?.[1];
    const value = previous && cookies.get(previous)?.user === user ? previous : token();
    cookies.set(value, { user, expires: Date.now() + 180_000 });
    res.setHeader(
      "Set-Cookie",
      `nuvio_media=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/playback; Max-Age=180`
    );
  }

  async function stop(session) {
    if (!session) return;
    session.stopped = true;
    sessions.delete(session.id);
    for (const child of session.processes) child.kill("SIGKILL");
    for (const source of session.readers) source.destroy();
    if (session.directory) await rm(session.directory, { recursive: true, force: true });
  }

  // Only FFmpeg can reach this listener; the public server exposes no URL proxy.
  const reader = http.createServer(async (req, res) => {
    const session = [...sessions.values()].find(
      (value) => req.url === "/" + value.readerToken && !value.stopped
    );
    if (!session || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const headers = { ...session.headers };
      if (req.headers.range) {
        if (!/^bytes=\d+-\d*$/.test(req.headers.range)) throw failure(400, "Invalid range.");
        headers.range = req.headers.range;
      }
      const upstream = await openSource(session.url, headers);
      if (res.destroyed || session.stopped) {
        upstream.destroy();
        return;
      }
      session.readers.add(upstream);
      res.on("close", () => {
        upstream.destroy();
        session.readers.delete(upstream);
      });
      const selected = {};
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"])
        if (upstream.headers[name]) selected[name] = upstream.headers[name];
      res.writeHead(upstream.statusCode, selected);
      if (req.method === "HEAD") {
        upstream.destroy();
        res.end();
      } else await pipeline(upstream, res);
    } catch (error) {
      if (!session.stopped && !res.destroyed) {
        session.sourceError = error instanceof SourceReadError
          ? error
          : failure(502, "The conversion server could not reach this media host. Try another source.");
      }
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  await new Promise((resolve) => reader.listen(0, "127.0.0.1", resolve));

  function launch(session, executable, args) {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    session.processes.add(child);
    child.once("close", () => session.processes.delete(child));
    // Never log FFmpeg output: upstream URLs and tokens may occur in diagnostics.
    child.stderr.resume();
    return child;
  }

  async function probe(session) {
    const child = launch(session, "ffprobe", [
      "-v",
      "error",
      ...inputArgs,
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      session.readerUrl
    ]);
    return new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(failure(504, "This source took too long to inspect. Try another source."));
      }, 20000);
      child.stdout.on("data", (data) => {
        output += data;
        if (output.length > 1024 * 1024) child.kill("SIGKILL");
      });
      child.once("error", () => {
        clearTimeout(timer);
        reject(failure(503, "Compatibility playback is unavailable."));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(session.sourceError || failure(422, "This source is not a readable media file. Try another source."));
          return;
        }
        try {
          resolve(compatibleProbe(JSON.parse(output)));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async function start(session, position, track) {
    const generation = ++session.generation;
    session.sourceError = null;
    if (
      session.encoder &&
      session.encoder.exitCode === null &&
      session.encoder.signalCode === null
    ) {
      const old = session.encoder;
      await new Promise((resolve) => {
        old.once("close", resolve);
        old.kill("SIGKILL");
      });
    }
    if (session.stopped || generation !== session.generation)
      throw failure(409, "Playback was cancelled.");
    const directory = join(session.directory, String(generation));
    await mkdir(directory);
    session.offset = position;
    session.track = track;
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      ...inputArgs,
      "-readrate",
      "1",
      "-ss",
      String(position),
      "-i",
      session.readerUrl,
      "-map",
      "0:v:0",
      "-map",
      `0:${track}`,
      "-c:v",
      "copy",
      "-tag:v",
      session.videoCodec === "hevc" ? "hvc1" : "avc1",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-b:a",
      "192k",
      "-threads",
      "1",
      "-sn",
      "-dn",
      "-avoid_negative_ts",
      "make_zero",
      "-f",
      "hls",
      "-hls_time",
      "4",
      "-hls_list_size",
      "8",
      "-hls_flags",
      "delete_segments+independent_segments+temp_file",
      "-hls_segment_type",
      "fmp4",
      "-hls_segment_filename",
      join(directory, "segment-%05d.m4s"),
      join(directory, "index.m3u8")
    ];
    const child = launch(session, "ffmpeg", args);
    child.stdout.resume();
    session.encoder = child;
    session.encoderError = false;
    child.once("error", () => {
      session.encoderError = true;
    });
    child.once("close", (code) => {
      if (code !== 0 && session.encoder === child) session.encoderError = true;
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !session.stopped && !session.encoderError) {
      try {
        const manifest = await readFile(join(directory, "index.m3u8"), "utf8");
        // A seek can produce a very short first segment. Buffer the next one
        // before starting playback so it cannot immediately outrun conversion.
        const segmentCount = (manifest.match(/^#EXTINF:/gm) || []).length;
        if (segmentCount >= 2 || (segmentCount > 0 && manifest.includes("#EXT-X-ENDLIST"))) {
          for (let old = 1; old < generation; old++)
            await rm(join(session.directory, String(old)), { recursive: true, force: true });
          return {
            id: session.id,
            url: `/api/playback/sessions/${session.id}/${generation}/index.m3u8`,
            duration: session.duration,
            offset: position,
            tracks: session.tracks,
            track,
            videoCodec: session.videoCodec
          };
        }
      } catch {}
      await pause(250);
    }
    throw session.sourceError || failure(422, "This source could not start in compatibility mode. Try another source.");
  }

  async function body(req) {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 16384) throw failure(413, "Request too large.");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw failure(400, "Invalid request.");
    }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const path = new URL(req.url, "http://local").pathname;
      if (path === "/api/playback/health" && req.method === "GET") {
        json(res, 200, {
          available: true,
          revision,
          maxSessions: MAX_SESSIONS,
          mode: "copy-video-aac-audio"
        });
        return;
      }
      const match =
        /^\/api\/playback\/sessions(?:\/([a-f0-9]{48})(?:\/(heartbeat|seek|\d+\/(?:index\.m3u8|init\.mp4|segment-\d+\.m4s)))?)?$/.exec(
          path
        );
      if (!match) throw failure(404, "Not found.");
      if (req.method !== "GET" && req.headers.origin !== origin)
        throw failure(403, "Origin not allowed.");
      const id = match[1],
        action = match[2];
      if (req.method === "POST") {
        const peer = req.socket.remoteAddress;
        const recent = (requests.get(peer) || []).filter((time) => Date.now() - time < 60000);
        if (recent.length >= 40)
          throw failure(429, "Too many playback requests. Try again shortly.");
        recent.push(Date.now());
        requests.set(peer, recent);
      }
      if (!id && req.method === "POST") {
        const user = await verify(req);
        const data = await body(req);
        if (typeof data.url !== "string") throw failure(400, "Missing media source.");
        if (data.preferredLanguages !== undefined && (!Array.isArray(data.preferredLanguages) ||
            data.preferredLanguages.length > 2 || data.preferredLanguages.some(value =>
              typeof value !== "string" || !/^[A-Za-z-]{2,35}$/.test(value))))
          throw failure(400, "Invalid audio language preference.");
        const headers = mediaHeaders(data.headers);
        // A new stream replaces this account's old one, even if its tab never sent DELETE.
        // stop() removes the old reservation synchronously; reserve the new one before awaiting.
        const previous = [...sessions.values()].find((session) => session.user === user);
        // Inspection shares the probe limit, but must not interrupt another tab's playback.
        if (data.inspect === true && previous)
          throw failure(409, "Audio tracks cannot be checked while another source is being prepared or converted.");
        const stopped = stop(previous);
        if (sessions.size >= MAX_SESSIONS)
          throw failure(
            429,
            "Both compatibility playback slots are busy. Try again shortly or choose an AAC source."
          );
        // Reserve before awaiting DNS/probe, so concurrent requests cannot exceed the cap.
        const session = {
          id: token(),
          readerToken: token(),
          user,
          url: data.url,
          headers,
          processes: new Set(),
          readers: new Set(),
          generation: 0,
          created: Date.now(),
          seen: Date.now()
        };
        sessions.set(session.id, session);
        try {
          await stopped;
          await validateSource(session.url);
          if (session.stopped) throw failure(409, "Playback was cancelled.");
          session.directory = await mkdtemp(join(root, "session-"));
          if (session.stopped) throw failure(409, "Playback was cancelled.");
          session.readerUrl = `http://127.0.0.1:${reader.address().port}/${session.readerToken}`;
          Object.assign(session, await probe(session));
          if (session.stopped) throw failure(409, "Playback was cancelled.");
          if (data.inspect === true) {
            const result = { tracks: session.tracks, track: selectAudioTrack(session.tracks),
              duration: session.duration, videoCodec: session.videoCodec };
            await stop(session);
            json(res, 200, result);
            return;
          }
          if (session.videoCodec === "hevc" && data.hevc !== true)
            throw failure(422, "Your browser cannot play this HEVC video. Choose an H.264 source.");
          const position = Math.min(session.duration - 1, Math.max(0, Number(data.position) || 0));
          const track = data.track ?? selectAudioTrack(session.tracks, data.preferredLanguages);
          if (!session.tracks.some(value => value.index === track))
            throw failure(400, "Invalid audio track.");
          const result = await start(session, position, track);
          setCookie(req, res, user);
          json(res, 201, result);
        } catch (error) {
          await stop(session);
          throw error;
        }
        return;
      }
      const session = sessions.get(id);
      if (!session) throw failure(404, "This compatibility session has ended. Start it again.");
      const user = req.method === "POST" ? await verify(req) : cookieOwner(req);
      if (user !== session.user)
        throw failure(403, "This playback session belongs to another account.");
      if (req.method === "DELETE" && !action) {
        await stop(session);
        json(res, 200, { stopped: true });
        return;
      }
      if (req.method === "POST" && action === "heartbeat") {
        if (session.encoderError)
          throw session.sourceError || failure(422, "Compatibility playback stopped. Try another source.");
        session.seen = Date.now();
        setCookie(req, res, user);
        json(res, 200, { active: true });
        return;
      }
      if (req.method === "POST" && action === "seek") {
        if (session.seeking) throw failure(409, "A seek is already in progress.");
        const data = await body(req);
        const position = Number(data.position),
          track = Number(data.track ?? session.track);
        if (
          !Number.isFinite(position) ||
          position < 0 ||
          position >= session.duration ||
          !session.tracks.some((value) => value.index === track)
        )
          throw failure(400, "Invalid position or audio track.");
        session.seeking = true;
        session.seen = Date.now();
        try {
          json(res, 200, await start(session, position, track));
        } catch (error) {
          await stop(session);
          throw error;
        } finally {
          session.seeking = false;
        }
        return;
      }
      if (req.method === "GET" && action && action.startsWith(session.generation + "/")) {
        const file = join(session.directory, action);
        let info;
        try {
          info = await stat(file);
        } catch {
          throw failure(404, "Segment expired.");
        }
        res.writeHead(200, {
          "Content-Type": file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4",
          "Content-Length": info.size
        });
        await pipeline(createReadStream(file), res);
        return;
      }
      throw failure(405, "Method not allowed.");
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status || 400, {
          error: error.status
            ? error.message
            : "This source could not be used for compatibility playback."
        });
      else res.end();
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values())
      if (now - session.seen > IDLE_MS || now - session.created > MAX_AGE_MS) void stop(session);
    for (const map of [cookies, authCache])
      for (const [key, value] of map) if (value.expires < now) map.delete(key);
    for (const [key, value] of requests) if (now - value.at(-1) > 60000) requests.delete(key);
  }, 15000);
  cleanup.unref();
  return {
    server,
    async close() {
      clearInterval(cleanup);
      await Promise.all([...sessions.values()].map(stop));
      reader.close();
      server.close();
    }
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {
    NUVIO_ORIGIN: origin,
    NUVIO_SUPABASE_URL: authUrl,
    NUVIO_SUPABASE_ANON_KEY: apiKey
  } = process.env;
  if (!origin || !authUrl || !apiKey) throw new Error("Missing playback bridge configuration.");
  const bridge = await createPlaybackBridge({ origin, authUrl, apiKey });
  bridge.server.listen(3100, "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, async () => {
      await bridge.close();
      process.exit(0);
    });
}
