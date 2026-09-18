import { mkdir, writeFile } from "node:fs/promises";
const revision = "152f629d3021fd8013efa464fcb7b55f9fbe7753";
const license = await fetch(
  `https://raw.githubusercontent.com/zhaohappy/libmedia/${revision}/COPYING.LGPLv3`
);
if (!license.ok) throw new Error(`License: ${license.status}`);
await mkdir("wasm", { recursive: true });
await writeFile("wasm/COPYING.LGPLv3", await license.text());
const paths = [
  "decode/ac3-simd.wasm",
  "decode/eac3-simd.wasm",
  "decode/dca-simd.wasm",
  "decode/aac-simd.wasm",
  "decode/h264-simd.wasm",
  "decode/hevc-simd.wasm",
  "resample/resample-simd.wasm",
  "stretchpitch/stretchpitch-simd.wasm"
];
await Promise.all(
  paths.map(async (path) => {
    const response = await fetch(
      `https://raw.githubusercontent.com/zhaohappy/libmedia/${revision}/dist/${path}`
    );
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    await mkdir(`wasm/${path.split("/")[0]}`, { recursive: true });
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(`wasm/${path}`, bytes);
    console.log(path, bytes.length);
  })
);
