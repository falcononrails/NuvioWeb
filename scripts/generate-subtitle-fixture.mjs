// node scripts/generate-subtitle-fixture.mjs /path/to/fixtures (requires FFmpeg)
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
const directory = resolve(process.argv[2] || "test-media");
await mkdir(directory, { recursive: true });
for (const language of ["English", "Spanish"]) {
  await writeFile(join(directory, `${language}.srt`), [5, 15, 25, 115, 135].map((second, index) => {
    const time = value => `00:${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")},000`;
    return `${index + 1}\n${time(second)} --> ${time(second + 3)}\n${language} ${second}\n`;
  }).join("\n"));
}
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10",
  "-f", "lavfi", "-i", "sine=frequency=440", "-f", "lavfi", "-i", "sine=frequency=880",
  "-i", join(directory, "English.srt"), "-i", join(directory, "Spanish.srt"),
  "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-map", "4:s",
  "-t", "150", "-c:v", "libx264", "-preset", "ultrafast", "-g", "20", "-c:a", "eac3", "-c:s", "srt",
  "-metadata:s:a:0", "language=spa", "-metadata:s:a:1", "language=eng",
  "-metadata:s:s:0", "language=eng", "-metadata:s:s:1", "language=spa", "-disposition:s:1", "forced",
  "-y", join(directory, "embedded-subtitles.mkv")], { stdio: "inherit" });
