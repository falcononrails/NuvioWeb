import { createPlaybackBridge } from "../../../services/playback-bridge/server.mjs";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const source = process.env.BENCHMARK_SOURCE_URL;
if (!source) throw Error("Set BENCHMARK_SOURCE_URL to the synthetic EAC3 fixture");
const bridge = await createPlaybackBridge({
  root: "/tmp/avplayer-server-comparison",
  origin: "https://benchmark.invalid",
  authenticate: async () => ({ id: "synthetic-benchmark", role: "authenticated" })
});
await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${bridge.server.address().port}`;
let cookie;
const cpu = async () =>
  Number((await readFile("/sys/fs/cgroup/cpu.stat", "utf8")).match(/usage_usec (\d+)/)[1]) / 1e6;
const post = async (path, data) => {
  const start = performance.now(),
    before = await cpu();
  const response = await fetch(base + "/api/playback/sessions" + path, {
    method: "POST",
    headers: {
      Origin: "https://benchmark.invalid",
      Authorization: "Bearer synthetic-avplayer-benchmark-only",
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(data)
  });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const body = await response.json();
  if (!response.ok) throw Error(JSON.stringify(body));
  return {
    body,
    ms: Math.round(performance.now() - start),
    cpuSeconds: Math.round(((await cpu()) - before) * 1000) / 1000
  };
};
try {
  for (let trial = 0; trial < 3; trial++) {
    const create = await post("", { url: source, preferredLanguages: ["en"] });
    const seek = await post(`/${create.body.id}/seek`, { position: 20 });
    const change = await post(`/${create.body.id}/seek`, {
      position: 20,
      track: create.body.tracks[1].index
    });
    console.log(
      JSON.stringify({
        trial,
        createMs: create.ms,
        createCpuSeconds: create.cpuSeconds,
        seekMs: seek.ms,
        seekCpuSeconds: seek.cpuSeconds,
        changeMs: change.ms,
        changeCpuSeconds: change.cpuSeconds
      })
    );
    await fetch(base + `/api/playback/sessions/${create.body.id}`, {
      method: "DELETE",
      headers: { Origin: "https://benchmark.invalid", cookie }
    });
  }
} finally {
  await bridge.close();
}
