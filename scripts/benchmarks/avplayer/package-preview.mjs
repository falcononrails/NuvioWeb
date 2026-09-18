import { cp, mkdir, writeFile } from "node:fs/promises";
await mkdir("public", { recursive: true });
for (const file of ["manual.html", "manual.js", "wasm", "media"])
  await cp(file, `public/${file}`, { recursive: true });
await cp("node_modules/@libmedia/avplayer/dist/umd", "public/avplayer", { recursive: true });
await cp("wasm/COPYING.LGPLv3", "public/COPYING.LGPLv3");
await writeFile(
  "public/NOTICE.txt",
  `AVPlayer 1.3.1 by Gaoxing Zhao, LGPL-3.0-or-later.\nSource, license and WASM build recipes: https://github.com/zhaohappy/libmedia/tree/152f629d3021fd8013efa464fcb7b55f9fbe7753\nThis preview serves unchanged upstream JavaScript and WASM binaries.\n`
);
console.log("Public synthetic test page: public/manual.html");
