import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("browser hero keeps its description and CSS bounds after rendering", async () => {
  const source = await readFile(new URL("./homeScreen.js", import.meta.url), "utf8");
  const methods = ["applyHomeTruncationState", "applyModernHeroDescriptionBounds"].map(name =>
    source.match(new RegExp(`  ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\},`))[0]
  ).join("\n");
  let selector;
  const screen = vm.runInNewContext(`({${methods}})`, { Platform: { isBrowser: () => true } });
  Object.assign(screen, {
    layoutMode: "modern", isPerformanceConstrained: () => false,
    container: { querySelectorAll(value) { selector = value; return []; } }
  });
  screen.applyHomeTruncationState();
  assert.equal(selector, ".home-poster-title, .home-poster-subtitle");
});
