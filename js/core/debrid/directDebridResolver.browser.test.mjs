import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};

const [
  { DebridApi },
  { DebridSettingsStore },
  { DirectDebridResolver, debridResolveErrorMessage },
  { DebridStreamPresentation },
  { DirectDebridStreamPreparer }
] = await Promise.all([
  import("../../data/remote/api/debridApi.js"),
  import("../../data/local/debridSettingsStore.js"),
  import("./directDebridResolver.js"),
  import("./directDebridStreamPresentation.js"),
  import("./directDebridStreamPreparer.js")
]);

test("resolver failures distinguish missing routes from provider files at every TorBox stage", async (context) => {
  const originalSettings = DebridSettingsStore.get();
  DebridSettingsStore.set({ ...originalSettings, enabled: true, torboxApiKey: "test-secret", preferredResolverProviderId: "torbox" }, { silentSync: true });
  const stages = {
    torboxCheckCached: ["cache/check", { data: { "failure-hash": {} } }],
    torboxCreateTorrent: ["torrent/create", { data: { torrent_id: "torrent-id" } }],
    torboxGetTorrent: ["torrent/lookup", { data: { files: [{ id: 7, name: "Example.mkv" }] } }],
    torboxRequestDownloadLink: ["link/resolve", { data: "https://example.test/video.mkv" }]
  };
  let failingStage;
  let response;
  let calls;
  for (const [method, [, data]] of Object.entries(stages)) {
    context.mock.method(DebridApi, method, async () => {
      calls.push(method);
      return method === failingStage ? response : { ok: true, status: 200, data };
    });
  }
  try {
    for (const [method, [operation]] of Object.entries(stages)) {
      failingStage = method;
      for (const [status, data, expected] of [
        [404, null, "service_unavailable"],
        [404, "<html>Not Found</html>", "service_unavailable"],
        [404, { error: "not_found" }, "service_unavailable"],
        [404, { error: "provider_request_failed", status: 404 }, "stale"],
        [401, null, "auth_failed"], [403, null, "auth_failed"],
        [429, null, "rate_limited"], [500, null, "service_degraded"],
        [502, null, "service_degraded"], [503, null, "service_degraded"],
        [504, null, "service_degraded"], [0, null, "network_error"],
        [200, {}, "error"],
        [409, null, operation === "torrent/create" ? "not_cached" : "error"]
      ]) {
        response = { ok: status === 200, status, data };
        calls = [];
        const result = await DirectDebridResolver.resolve({ infoHash: "failure-hash" });
        assert.equal(result.status, expected, `${operation} HTTP ${status}`);
        if (status !== 200) assert.match(result.detail, new RegExp(operation));
        assert.equal(calls.at(-1), method, "Stop after the failed request");
        assert.doesNotMatch(debridResolveErrorMessage(result), /expired|refreshing|test-secret/i);
      }
    }
    calls = [];
    const direct = await DirectDebridResolver.resolve({ url: "https://example.test/direct.mp4" });
    assert.equal(direct.status, "success");
    assert.equal(calls.length, 0, "Direct addon links bypass the debrid bridge");
  } finally {
    DebridSettingsStore.set(originalSettings, { silentSync: true });
  }
});

test("a cached raw torrent resolves through the existing TorBox resolver path instead of becoming stale", async () => {
  const originalSettings = DebridSettingsStore.get();
  const originalCreate = DebridApi.torboxCreateTorrent;
  const originalLookup = DebridApi.torboxGetTorrent;
  const originalLink = DebridApi.torboxRequestDownloadLink;
  const calls = [];
  DebridSettingsStore.set(
    {
      ...originalSettings,
      enabled: true,
      torboxApiKey: "test-credential",
      preferredResolverProviderId: "torbox"
    },
    { silentSync: true }
  );
  DebridApi.torboxCreateTorrent = async (_credential, magnet) => {
    calls.push(["create", magnet]);
    return { ok: true, status: 200, data: { success: true, data: { torrent_id: "torrent-id" } } };
  };
  DebridApi.torboxGetTorrent = async (_credential, torrentId) => {
    calls.push(["lookup", torrentId]);
    return {
      ok: true,
      status: 200,
      data: { success: true, data: { files: [{ id: 7, name: "Example.S01E01.mkv", size: 42 }] } }
    };
  };
  DebridApi.torboxRequestDownloadLink = async (_credential, torrentId, fileId) => {
    calls.push(["resolve", torrentId, fileId]);
    return { ok: true, status: 200, data: { success: true, data: "https://provider.example/video" } };
  };

  try {
    const result = await DirectDebridResolver.resolve({
      infoHash: "cached-hash",
      debridCacheStatus: { state: "CACHED" },
      title: "Example S01E01"
    });
    assert.equal(result.status, "success");
    assert.equal(result.stream.url, "https://provider.example/video");
    assert.deepEqual(calls.map(([operation]) => operation), ["create", "lookup", "resolve"]);
  } finally {
    DebridApi.torboxCreateTorrent = originalCreate;
    DebridApi.torboxGetTorrent = originalLookup;
    DebridApi.torboxRequestDownloadLink = originalLink;
    DebridSettingsStore.set(originalSettings, { silentSync: true });
  }
});

test("Resolve playable links off retains raw addon results and bypasses managed debrid presentation and preparation", async () => {
  const originalSettings = DebridSettingsStore.get();
  const originalCreate = DebridApi.torboxCreateTorrent;
  let createCalls = 0;
  const groups = [
    {
      addonName: "Addon",
      streams: [
        { infoHash: "cached-hash", name: "Cached raw", debridCacheStatus: { state: "CACHED" } },
        { infoHash: "uncached-hash", name: "Uncached raw", debridCacheStatus: { state: "NOT_CACHED" } },
        { infoHash: "unknown-hash", name: "Unknown raw" },
        { url: "https://example.test/direct.mp4", name: "Direct HTTP" }
      ]
    }
  ];
  DebridSettingsStore.set(
    {
      ...originalSettings,
      enabled: false,
      torboxApiKey: "test-credential",
      preferredResolverProviderId: "torbox",
      instantPlaybackPreparationLimit: 2
    },
    { silentSync: true }
  );
  DebridApi.torboxCreateTorrent = async () => {
    createCalls += 1;
    throw new Error("preparation must not run while resolve is off");
  };

  try {
    assert.equal(DirectDebridResolver.shouldListStream(groups[0].streams[0]), true);
    assert.equal(DirectDebridResolver.shouldListStream(groups[0].streams[1]), true);
    assert.equal(DirectDebridResolver.shouldListStream(groups[0].streams[2]), true);
    assert.equal(DirectDebridResolver.shouldListStream(groups[0].streams[3]), true);
    const off = DebridStreamPresentation.apply(groups);
    assert.deepEqual(off, groups);
    await DirectDebridStreamPreparer.prepare(groups[0].streams);
    assert.equal(createCalls, 0);

    DebridSettingsStore.set({ ...DebridSettingsStore.get(), enabled: true }, { silentSync: true });
    const on = DebridStreamPresentation.apply(groups);
    assert.equal(on[0].streams.some((stream) => stream.name === "Uncached raw"), false);
    assert.equal(on[0].streams.some((stream) => stream.name === "Direct HTTP"), true);

    DebridSettingsStore.set({ ...DebridSettingsStore.get(), enabled: false }, { silentSync: true });
    const offAgain = DebridStreamPresentation.apply(groups);
    assert.deepEqual(offAgain, groups);
  } finally {
    DebridApi.torboxCreateTorrent = originalCreate;
    DebridSettingsStore.set(originalSettings, { silentSync: true });
  }
});
