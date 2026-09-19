// node scripts/poster-menu-smoke.mjs: real card bindings and menus, synthetic local state.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = [
  ["HomeScreen", "home/homeScreen", "home-content-card home-poster-card"],
  ["SearchScreen", "search/searchScreen", "search-result-card"],
  ["DiscoverScreen", "search/discoverScreen", "discover-card seeall-card"],
  ["LibraryScreen", "library/libraryScreen", "library-grid-card"],
  ["CatalogSeeAllScreen", "catalog/catalogSeeAllScreen", "seeall-card"],
  ["CastDetailScreen", "cast/castDetailScreen", "cast-credit-card"],
  ["MetaDetailsScreen", "detail/metaDetailsScreen", "detail-morelike-card", "openMoreLikeDetail"],
  ["FolderDetailScreen", "collection/folderDetailScreen", "seeall-card"]
];
const bindings = {};
for (const [name, file] of routes) {
  const source = await readFile(path.join(root, `js/ui/screens/${file}.js`), "utf8");
  bindings[name] = source.match(/bindBrowserCardTouchIntent\(this.container, \{([\s\S]*?)\n\s*\}\)/)[1];
}
const script = `
${routes.map(([name, file]) => `import {${name}} from './js/ui/screens/${file}.js';`).join("\n")}
import {bindBrowserCardTouchIntent} from './js/ui/components/browserCardTouchIntent.js';
import {savedLibraryRepository} from './js/data/repository/savedLibraryRepository.js';
import {watchedItemsRepository} from './js/data/repository/watchedItemsRepository.js';
import {watchProgressRepository} from './js/data/repository/watchProgressRepository.js';
import {libraryRepository, LibrarySourceMode} from './js/data/repository/libraryRepository.js';
import {I18n} from './js/i18n/index.js';
await I18n.init();
savedLibraryRepository.isSaved=async()=>Boolean(window.saved);
savedLibraryRepository.toggle=async()=>window.saved=!window.saved;
watchedItemsRepository.getAll=async()=>window.watched?[{contentId:'fixture'}]:[];
watchedItemsRepository.isWatched=async()=>Boolean(window.watched);
watchedItemsRepository.mark=async()=>{window.watched=true};
watchedItemsRepository.unmark=async()=>{window.watched=false};
watchProgressRepository.saveProgress=watchProgressRepository.removeProgress=async()=>{};
libraryRepository.getSourceMode=async()=>LibrarySourceMode.LOCAL;
libraryRepository.getMembershipSnapshot=async()=>({listMembership:{}});
const screens={${routes.map(([name]) => name).join(",")}};
const bindings=${JSON.stringify(bindings)};
window.mount=([name, ,classes,action='openDetail'])=>{
  window.unbind?.();
  const container=document.querySelector('main');
  container.innerHTML='<article tabindex="0" class="focusable '+classes+'" data-action="'+action+'" data-item-id="fixture" data-item-type="movie" data-item-title="Synthetic film" data-item-index="0" data-focus-key="fixture"><div class="art">Synthetic film</div></article><input aria-label="Unrelated input">';
  const card=container.querySelector('article');
  window.details=0;
  window.s=Object.assign(Object.create(screens[name]),{
    container, params:{}, controller:{setFocusedPosterKey(){}}, watchedTitleIds:new Set(),
    captureLiveViewState(){}, captureFocusState(){return {}}, getPosterFocusDescriptor(){return {}},
    focusNode(){card.focus({preventScroll:true})}, focusDetailDescriptor(){card.focus({preventScroll:true})},
    restorePosterHoldMenuFocus(){card.focus({preventScroll:true})},
    restoreContinueWatchingMenuFocus(){card.focus({preventScroll:true})},
    captureHoldMenuScrollState(){return {}}, scheduleHoldMenuScrollRestore(){},
    lockHomeHoldFocus(){}, unlockHomeHoldFocus(){}, syncFocusedCardScroll(){},
    render(){}, requestRender(){}, refreshWatchedTitleIds:async()=>{},
    openDetailFromNode(){window.details++}
  });
  // Use each screen's checked-in binding expression rather than duplicating its selectors.
  window.unbind=bindBrowserCardTouchIntent(container,Function('return ({'+bindings[name]+'})').call(s));
  card.addEventListener('click',()=>window.details++);
};
window.ready=true;
`;
const bundle = (await build({ stdin: { contents: script, resolveDir: root }, bundle: true,
  write: false, format: "esm", plugins: [{ name: "local-router", setup(api) {
    api.onResolve({ filter: /navigation\/router\.js$/ }, () => ({ path: "router", namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents:
      'export const Router={getCurrent:()=>"home",navigate:async()=>{window.details++}};' }));
  } }] })).outputFiles[0].text;
const html = `<!doctype html><html class="desktop-browser"><head>${["base", "layout", "components", "themes", "desktop", "desktop-theme"].map(name => `<link rel="stylesheet" href="/css/${name}.css">`).join("")}
<style>main{padding:32px}article{width:180px;height:270px;background:#313131;border-radius:12px;cursor:pointer}.art{padding:24px}input{margin-top:24px}</style></head><body class="desktop-browser"><main></main><script type="module" src="/harness.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/") return res.writeHead(200, { "Content-Type": "text/html" }).end(html);
    if (pathname === "/harness.js") return res.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle);
    const file = path.resolve(root, "." + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": { ".css": "text/css", ".json": "application/json", ".js": "text/javascript", ".woff2": "font/woff2" }[path.extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.ready);
  for (const route of routes) {
    await page.evaluate(route => window.mount(route), route);
    await page.locator("article .art").click({ button: "right" });
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByRole("button", { name: /Go to details/i }).count(), 1, route[0]);
    assert.equal(await page.getByRole("button", { name: /library/i }).count(), 1, route[0]);
    assert.equal(await page.getByRole("button", { name: /watched/i }).count(), 1, route[0]);
    assert.equal(await page.evaluate(() => window.details), 0, "Right-click must not activate the poster");
    assert.equal(await page.getByRole("button").first().evaluate(node => getComputedStyle(node).cursor), "pointer");
    if (route[0] === "SearchScreen") {
      await page.waitForFunction(() => [...document.querySelectorAll('.nuvio-dialog-backdrop, .nuvio-dialog-panel')].every(node => getComputedStyle(node).opacity === '1'));
      await page.screenshot({ path: path.join(root, "../poster-menu-qa.png") });
    }
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.locator("article").click({ button: "right" });
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForFunction(() => window.details === 1, {}, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.details), 1, "The first Enter must work after right-click");
    await page.locator("article").click();
    assert.equal(await page.evaluate(() => window.details), 2, "Left-click must still activate normally");
    assert.equal(await page.getByRole("textbox").evaluate(node => node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))), true, "Non-card context menus remain native");
    await page.evaluate(() => window.unbind());
    assert.equal(await page.locator("article").evaluate(node => node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))), true);
    console.log("PASS right-click, dismissal, keyboard activation and cleanup: " + route[0]);
  }
  await page.evaluate(route => window.mount(route), routes[1]);
  for (const [label, state] of [["Add to Library", "saved"], ["Mark as watched", "watched"]]) {
    await page.locator("article").click({ button: "right" });
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(state => window[state], state), true, label);
  }
  await page.evaluate(() => {
    window.mount(['HomeScreen', '', 'home-continue-card']);
    s.continueWatchingRenderedItems=[{contentId:'fixture',videoId:'fixture:1:1',name:'Synthetic film',type:'series',position:120,duration:1800}];
    document.querySelector('article').dataset.cwIndex='0';
  });
  await page.locator("article").click({ button: "right" });
  await page.getByRole("button", { name: "Start from beginning", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Remove", exact: true }).count(), 1);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.details), 0);
  console.log("PASS library/watched actions and Continue Watching menu");
  assert.deepEqual(errors, []);
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
