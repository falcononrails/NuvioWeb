// node scripts/calendar-season-smoke.mjs: actual screens with synthetic local metadata.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../calendar-season-qa');
await mkdir(output, {recursive:true});
const script = `
import {Router} from './js/ui/navigation/router.js';
import {FocusEngine} from './js/ui/navigation/focusEngine.js';
import {CalendarScreen as calendar} from './js/ui/screens/calendar/calendarScreen.js';
import {MetaDetailsScreen as detail} from './js/ui/screens/detail/metaDetailsScreen.js';
import {LayoutPreferences} from './js/data/local/layoutPreferences.js';
import {libraryRepository} from './js/data/repository/libraryRepository.js';
import {metaRepository} from './js/data/repository/metaRepository.js';
import {ProfileManager} from './js/core/profile/profileManager.js';
import {I18n} from './js/i18n/index.js';
import {ThemeManager} from './js/ui/theme/themeManager.js';
await I18n.init(); ThemeManager.apply();
ProfileManager.getProfiles=async()=>[];
const poster=n=>location.origin+'/poster/'+n+'.svg';
const episodes=[0,1,2,3,4,5].flatMap(season=>[1,2].map(episode=>({id:'fixture:'+season+':'+episode,season,episode,title:'Episode '+episode,thumbnail:poster(season),overview:'Synthetic episode metadata.',released:'2026-09-19',seasonPoster:season===3?location.origin+'/missing.svg':season===4?null:poster(season)})));
const meta={id:'fixture',type:'series',name:'Synthetic series',description:'A local fixture for season artwork, selection and release dates.',videos:episodes};
Object.assign(window,{calendar,detail,Router,LayoutPreferences});
window.showSeasons=async()=>{
  await Router.navigate('detail');
};
const detailRoute={
 container:document.querySelector('#detail'),
 mount(params){
   window.detailParams=params;
   Object.assign(detail,{container:this.container,params:{itemId:'fixture',itemType:'series'},meta,episodes,selectedSeason:1,selectedRatingSeason:1,episodeProgressMap:new Map(),watchedEpisodeKeys:new Set(),episodeThumbnailPrefetchCache:new Set(),collectionItems:[],moreLikeThisItems:[],commentsItems:[],localOfflineDownloads:[],seriesInsightTab:'cast',episodeFocusIndexBySeason:{},railFocusIndexByKey:{},isTrailerPlaying:false,trailerPlaybackMode:null,trailerVisualReady:false});
   this.container.style.display='block'; detail.render(meta);
 },
 onKeyDown:event=>detail.onKeyDown(event),onKeyUp:event=>detail.onKeyUp(event),
 captureRouteState:()=>({}),cleanup:()=>detail.cleanup()
};
const seeds=Array.from({length:10},(_,index)=>({id:'item'+index,type:index===1?'movie':'series',name:index===0?'North Shore':index===1?'The Last Light':'Series '+index,poster:poster(index)}));
window.calls=0;window.inflight=0;window.peak=0;window.waiters=[];
libraryRepository.getItems=async()=>window.empty?[]:seeds;
metaRepository.getMetaFromAllAddons=async(type,id)=>{
 window.calls++;window.inflight++;window.peak=Math.max(window.peak,window.inflight);
 if(window.hold)await new Promise(resolve=>window.waiters.push(resolve));
 else await new Promise(resolve=>setTimeout(resolve,50));
 window.inflight--;
 if(id==='item9')throw Error('Synthetic unavailable addon');
 const seed=seeds.find(item=>item.id===id);
 return {status:'success',data:{...seed,released:'2026-09-19',videos:[{id:id+':2:1',season:2,episode:1,title:'A new beginning',released:'2026-09-19'},{id:id+':2:2',season:2,episode:2,title:'The next chapter',released:'2026-09-26'}]}};
};
Router.routes={calendar,detail:detailRoute};Router.init();FocusEngine.init();
await Router.navigate('calendar');window.ready=true;
`;
const bundle=(await build({stdin:{contents:script,resolveDir:root},bundle:true,write:false,format:'esm'})).outputFiles[0].text;
const html=`<!doctype html><html class="desktop-browser"><head><meta name="viewport" content="width=device-width,initial-scale=1">${['base','layout','components','themes','desktop','desktop-theme'].map(n=>`<link rel="stylesheet" href="/css/${n}.css">`).join('')}</head><body class="desktop-browser"><div id="app"><div class="screen" id="calendar"></div><div class="screen" id="detail"></div></div><script type="module" src="/harness.js"></script></body></html>`;
const server=createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/')return res.writeHead(200,{'Content-Type':'text/html'}).end(html);
  if(pathname==='/harness.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(bundle);
  if(pathname.startsWith('/poster/')){
    const number=Number(pathname.match(/\d+/)?.[0]||0);
    return res.writeHead(200,{'Content-Type':'image/svg+xml'}).end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="hsl(${number*45+175},28%,25%)"/><path d="M0 210 90 90 200 180V300H0" fill="hsl(${number*45+175},25%,18%)"/><text x="100" y="210" font-family="sans-serif" font-size="32" fill="white" text-anchor="middle">Season ${number}</text></svg>`);
  }
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':{'.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'}[path.extname(file)]||'application/octet-stream'}).end(body);
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack)});
 await page.clock.setFixedTime(new Date('2026-09-19T12:00:00'));
 await page.route('**/*',route=>/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(route.request().url())||route.request().url().startsWith(url)?route.continue():route.abort());
 await page.goto(url);await page.waitForFunction(()=>window.ready&&!calendar.loading);
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.evaluate(()=>peak),4);
 assert.equal(await page.evaluate(()=>calls),10);
 assert.match(await page.locator('.calendar-status').innerText(),/1 title couldn't/);
 assert.equal(await page.locator('[data-calendar-date]').count(),30);
 assert.equal(await page.locator('.calendar-release').count(),9);
 assert.equal(await page.locator('[data-desktop-route="calendar"]').getAttribute('aria-current'),'page');
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No calendar overflow at '+width);
  const nav=await page.locator('.desktop-navigation-item').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,cursor:getComputedStyle(el).cursor}}));
  assert.equal(nav.length,6);assert.ok(nav.every(r=>r.left>=0&&r.right<=width&&r.cursor==='pointer'));
  await page.screenshot({animations:'disabled',path:path.join(output,'calendar-'+width+'.png')});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Next month',exact:true}).click();
 assert.equal(await page.locator('[data-calendar-date]').count(),31);
 assert.equal(await page.evaluate(()=>calls),10,'Changing month reuses loaded metadata');
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await page.locator('[data-calendar-date="2026-09-19"]').focus();
 await page.keyboard.press('ArrowRight');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.calendarDate),'2026-09-20');
 await page.keyboard.press('PageUp');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.calendarDate),'2026-08-20');
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await page.locator('.calendar-release').filter({hasText:'North Shore'}).click();
 assert.equal(await page.evaluate(()=>Router.getCurrent()),'detail');
 assert.equal(await page.evaluate(()=>detailParams.preferredSeason),2);
 assert.equal(await page.evaluate(()=>detailParams.itemId),'item0');
 const toggle=page.locator('.series-season-view-toggle');
 assert.equal(await toggle.innerText(),'Posters');
 assert.equal(await page.locator('.series-season-poster-btn').count(),6);
 await page.waitForFunction(()=>!document.querySelector('[data-season="3"] img'));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  await toggle.scrollIntoViewIfNeeded();
  await page.screenshot({animations:'disabled',path:path.join(output,'seasons-'+width+'.png')});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('.series-season-btn[data-season="2"]').click();
 assert.equal(await page.evaluate(()=>detail.selectedSeason),2);
 await toggle.click();assert.equal(await toggle.innerText(),'Text');
 assert.equal(await page.locator('.series-season-poster-btn').count(),0);
 assert.equal(await page.locator('.series-season-btn.selected').getAttribute('data-season'),'2');
 await toggle.focus();await page.keyboard.press('Enter');
 assert.equal(await toggle.innerText(),'Posters','Enter must toggle once');
 await toggle.click();
 await page.reload();await page.waitForFunction(()=>window.ready&&!calendar.loading);
 await page.evaluate(()=>showSeasons());
 assert.equal(await toggle.innerText(),'Text','Mode survives reload');
 await page.evaluate(()=>{detail.meta={};detail.episodes=detail.episodes.map(({seasonPoster,...episode})=>episode);detail.render(detail.meta)});
 assert.equal(await toggle.count(),0,'Without art, use ordinary season tabs');
 // Leave during a metadata request: late responses must not paint a dead screen.
 await page.evaluate(async()=>{await Router.navigate('calendar');window.hold=true;void calendar.loadLibrary();});
 await page.waitForFunction(()=>waiters.length===4);
 await page.evaluate(()=>calendar.cleanup());
 await page.evaluate(()=>{window.hold=false;waiters.splice(0).forEach(resolve=>resolve())});
 await page.waitForFunction(()=>inflight===0);
 assert.equal(await page.locator('#calendar').innerHTML(),'');
 await page.evaluate(async()=>{window.empty=true;await calendar.mount()});
 await page.waitForFunction(()=>!calendar.loading);
 assert.match(await page.locator('.calendar-status').innerText(),/Add movies or series/);
 assert.deepEqual(errors,[]);
 console.log('Calendar/season smoke passed: bounded loading, partial failures, dates, keyboard, responsive navigation, detail links, poster fallback, mode persistence and cleanup.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
