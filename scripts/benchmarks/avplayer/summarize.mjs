import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const median = (values) => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length
    ? Math.round(((s[Math.floor(s.length / 2)] + s[Math.floor((s.length - 1) / 2)]) / 2) * 10) / 10
    : null;
};
const groups = new Map();
for (const file of await readdir(path.join(root, "results"))) {
  if (!file.endsWith(".json") || !file.startsWith(process.env.RUN_LABEL || "")) continue;
  const result = JSON.parse(await readFile(path.join(root, "results", file), "utf8"));
  if (!result.mode) continue;
  const key = result.mode + ":" + result.file;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(result);
}
const summary = [...groups].map(([source, runs]) => {
  const event = (r, name) => r.events.find((e) => e.name === name)?.ms;
  return {
    source,
    runs: runs.length,
    successful: runs.filter((r) => r.ok).length,
    startMs: median(runs.map((r) => event(r, "firstVideoRendered") ?? event(r, "playResolved"))),
    seekMs: median(runs.map((r) => r.seekMs)),
    switchMs: median(runs.map((r) => r.switchMs)),
    rendererCpuPercentOfOneCore: median(
      runs.map(
        (r) =>
          (100 * r.metrics?.find((m) => m.name === "ProcessTime")?.value) / (r.elapsedMs / 1000)
      )
    ),
    jsHeapMiB: median(
      runs.map((r) => r.metrics?.find((m) => m.name === "JSHeapUsedSize")?.value / 1024 / 1024)
    ),
    initialObservedAudioMinusVideoMs: median(
      runs.flatMap((r) =>
        (r.detectionTimes?.video || [])
          .filter((t) => t > event(r, "playResolved") + 1000 && t < event(r, "seekStart"))
          .map((t) => {
            const nearest = r.detectionTimes.audio.reduce(
              (best, a) => (Math.abs(a - t) < Math.abs(best - t) ? a : best),
              Infinity
            );
            return Math.abs(nearest - t) < 500 ? nearest - t : NaN;
          })
      )
    ),
    decodeErrors: runs
      .map((r) => r.samples.at(-1))
      .reduce(
        (sum, s) =>
          sum + (s?.audioDecodeErrorPacketCount || 0) + (s?.videoDecodeErrorPacketCount || 0),
        0
      ),
    droppedFrames: runs.map((r) => r.samples.at(-1)?.videoFrameDropCount ?? null),
    pauseAdvanceMs: runs.map((r) => r.pausedAdvanceMs ?? null),
    verifiedSwitches: runs.filter((r) => r.selectedTrack && r.trackSwitchVerified).length,
    requestedWasm: [...new Set(runs.flatMap((r) => r.requestedWasm))],
    browser: runs[0].browser,
    environment: runs[0].environment,
    results: runs.map((r) => ({
      startMs: event(r, "firstVideoRendered") ?? event(r, "playResolved"),
      seekMs: r.seekMs,
      switchMs: r.switchMs,
      ok: r.ok
    }))
  };
});
await writeFile(path.join(root, "results/summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
