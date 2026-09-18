// node scripts/mobile-settings-smoke.mjs [--serve]
// Exercises real settings rendering with local-only catalog/profile fixtures.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "../mobile-settings-qa");
await mkdir(output, { recursive: true });
const script = `
import { SettingsScreen as settings } from './js/ui/screens/settings/settingsScreen.js';
import { I18n } from './js/i18n/index.js';
import { addonRepository } from './js/data/repository/addonRepository.js';
import { HomeCatalogStore } from './js/data/local/homeCatalogStore.js';
import { LayoutPreferences } from './js/data/local/layoutPreferences.js';
import { Router } from './js/ui/navigation/router.js';
import { bindCollectionTouchAnimations } from './js/ui/components/collectionTouchAnimations.js';
import { HomeScreen } from './js/ui/screens/home/homeScreen.js';
await I18n.init();
addonRepository.getInstalledAddons = async () => [{id:'test', displayName:'Test catalogs', baseUrl:'https://example.org', catalogs:Array.from({length:40},(_,i)=>({id:String(i),apiType:'movie',name:'Catalog '+i}))}];
if (!localStorage.getItem('fixture-ready')) {
  HomeCatalogStore.set({order:['removed_other_torbox', ...Array.from({length:40},(_,i)=>'test_movie_'+i)],disabled:['test_movie_2']},{silentSync:true});
  LayoutPreferences.set({heroSectionEnabled:true, heroCatalogKeys:['test_movie_0']},{silentSync:true});
  localStorage.setItem('fixture-ready','true');
}
Router.current='settings';
Router.navigate=async()=>{};
window.settings=settings;
window.layout=LayoutPreferences;
window.mountCollections=()=>{
  settings.cleanup();
  document.querySelector('#settings').hidden=true;
  const container=document.querySelector('#collections');
  container.hidden=false;
  container.innerHTML=Array.from({length:8},(_,i)=>'<div class="home-collection-card" data-focus-gif-enabled="true" style="height:280px;margin:16px;background:#181818">Collection '+i+'<img class="home-poster-focus-gif" data-src="/animation.gif" alt="" style="width:100px;height:100px"></div>').join('');
  window.stopCollections=bindCollectionTouchAnimations(container,(card,active)=>HomeScreen.hydrateCollectionFocusGif(card,active));
};
document.addEventListener('keydown',e=>void settings.onKeyDown(e));
await settings.mount();
window.ready=true;
`;
const bundle = (await build({stdin:{contents:script,resolveDir:root},bundle:true,write:false,format:"esm",plugins:[{
  name:'isolate-settings-router',setup(api){
    api.onResolve({filter:/navigation\/router\.js$/},()=>({path:'router',namespace:'fixture'}));
    api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const Router={current:"settings",getCurrent(){return this.current},navigate:async()=>{}};'}));
  }
}]})).outputFiles[0].text;
const html = `<!doctype html><html class="desktop-browser"><head><meta name="viewport" content="width=device-width, initial-scale=1">${["base","layout","components","themes","desktop","desktop-theme"].map(name=>`<link rel="stylesheet" href="/css/${name}.css">`).join("")}</head><body class="desktop-browser"><div id="app"><div id="settings" class="screen"></div><div id="collections" hidden></div></div><script type="module" src="/harness.js"></script></body></html>`;
const server = createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/') return res.writeHead(200,{'Content-Type':'text/html'}).end(html);
    if(pathname==='/harness.js') return res.writeHead(200,{'Content-Type':'text/javascript'}).end(bundle);
    if(pathname==='/animation.gif') return res.writeHead(200,{'Content-Type':'image/gif'}).end(Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==','base64'));
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(root+path.sep)) return res.writeHead(403).end();
    const mime={'.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2'};
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(body);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(process.argv.includes('--serve')?4188:0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')) console.log(url);
else {
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors=[];
    page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
    await page.goto(url);
    await page.waitForFunction(()=>window.ready);
    assert.equal(await page.locator('.settings-mobile-title').isVisible(),true);
    assert.equal(await page.locator('.settings-content-frame').isVisible(),false);
    await page.screenshot({path:path.join(output,'settings-index.png'),fullPage:true});
    for(const section of ['account','profiles','layout','playback','about']) {
      await page.locator('[data-section="'+section+'"]').tap();
      assert.equal(await page.locator('.settings-sidebar-frame').isVisible(),false);
      assert.equal(await page.locator('[data-settings-back]').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,section+' should not overflow horizontally');
      await page.locator('[data-settings-back]').tap();
    }
    await page.locator('[data-section="layout"]').tap();
    await page.locator('[data-focus-key="layout:toggle:homeContent"]').tap();
    await page.locator('[data-focus-key="layout:heroCatalogs"]').tap();
    await page.getByRole('checkbox').first().waitFor();
    assert.equal(await page.getByRole('checkbox').count(),39,'removed and disabled catalogs are excluded');
    await page.getByRole('checkbox',{name:/Catalog 30 /}).scrollIntoViewIfNeeded();
    await page.evaluate(()=>{window.originalList=document.querySelector('.settings-dialog-list');window.originalScroll=originalList.scrollTop;});
    await page.getByRole('checkbox',{name:/Catalog 30 /}).tap();
    await page.getByRole('checkbox',{name:/Catalog 31 /}).tap();
    assert.equal(await page.evaluate(()=>originalList===document.querySelector('.settings-dialog-list')),true,'taps must not replace the list');
    assert.equal(await page.evaluate(()=>originalList.scrollTop),await page.evaluate(()=>originalScroll),'taps must not shift scroll');
    assert.equal(await page.getByRole('checkbox',{name:/Catalog 30 /}).getAttribute('aria-checked'),'true');
    await page.screenshot({path:path.join(output,'hero-catalogs.png')});
    await page.getByRole('button',{name:'Done',exact:true}).tap();
    await page.getByRole('dialog').waitFor({state:'detached'});
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.evaluate(()=>layout.get().heroCatalogKeys.includes('test_movie_30')),true);
    await page.reload();
    await page.waitForFunction(()=>window.ready);
    assert.equal(await page.locator('.settings-mobile-title').isVisible(),true);
    assert.equal(await page.evaluate(()=>layout.get().heroCatalogKeys.includes('test_movie_31')),true);
    await page.locator('[data-section="account"]').tap();
    await page.evaluate(()=>settings.consumeBackRequest());
    assert.equal(await page.locator('.settings-mobile-title').isVisible(),true);
    assert.equal(await page.evaluate(()=>settings.consumeBackRequest()),false,'Back from the index leaves Settings');
    await page.setViewportSize({width:1440,height:900});
    await page.waitForFunction(()=>document.querySelector('.settings-shell').dataset.mobilePage==='index' && !document.querySelector('.settings-nav-subtitle'));
    assert.equal(await page.locator('.settings-content-frame').isVisible(),true);
    assert.equal(await page.locator('.settings-sidebar-frame').isVisible(),true);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>mountCollections());
    await page.waitForFunction(()=>document.querySelectorAll('#collections img[src]').length>0);
    const initial=await page.locator('#collections img[src]').count();
    assert.ok(initial>0&&initial<8,'only visible cards load');
    await page.locator('.home-collection-card').last().scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>!document.querySelector('#collections img').hasAttribute('src'));
    await page.evaluate(()=>document.querySelector('#collections').inert=true);
    await page.waitForFunction(()=>document.querySelectorAll('#collections img[src]').length===0);
    await page.evaluate(()=>document.querySelector('#collections').inert=false);
    await page.waitForFunction(()=>document.querySelectorAll('#collections img[src]').length>0);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>document.querySelectorAll('#collections img[src]').length===0);
    await page.evaluate(()=>stopCollections());
    assert.deepEqual(errors,[]);
    console.log('PASS: phone navigation, picker stability/persistence, desktop layout, visible-only touch animations, reduced motion and covered-route cleanup');
  } finally {await browser.close();server.close();}
}




