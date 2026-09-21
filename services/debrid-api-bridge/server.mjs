import { createDebridApiBridgeServer } from "./bridge.mjs";
import { readFile } from "node:fs/promises";

const port = Math.max(1, Number(process.env.PORT || 8080) || 8080);
const revision = await readFile(new URL("../../release.json", import.meta.url), "utf8")
  .then(text => JSON.parse(text).commit).catch(() => null);
const server = createDebridApiBridgeServer({ revision });

server.listen(port, "0.0.0.0", () => {
  console.log(`Debrid API bridge listening on ${port}`);
});
