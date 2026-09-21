// Real browser keyboard flows and axe checks, with synthetic data and no account writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = `
import { FocusEngine } from './js/ui/navigation/focusEngine.js';
import { Router } from './js/ui/navigation/router.js';
import { ScreenUtils } from './js/ui/navigation/screen.js';
import { NuvioDialog } from './js/ui/components/nuvioDialog.js';
import { renderDesktopNavigation, bindDesktopNavigationEvents } from './js/ui/components/desktopNavigation.js';
import { PlayerScreen } from './js/ui/screens/player/playerScreen.js';
import { AuthSignInScreen } from './js/ui/screens/account/authSignInScreen.js';
import { SettingsScreen as settings } from './js/ui/screens/settings/settingsScreen.js';
import { I18n } from './js/i18n/index.js';
import { ThemeManager } from './js/ui/theme/themeManager.js';
import { addonRepository } from './js/data/repository/addonRepository.js';
import { LibraryScreen as library } from './js/ui/screens/library/libraryScreen.js';
import { LibraryController } from './js/ui/screens/library/libraryController.js';
import { MetaDetailsScreen as detail } from './js/ui/screens/detail/metaDetailsScreen.js';
import { CalendarScreen as calendar } from './js/ui/screens/calendar/calendarScreen.js';
import { SearchScreen as search } from './js/ui/screens/search/searchScreen.js';
import { StreamScreen } from './js/ui/screens/stream/streamScreen.js';
import { libraryRepository } from './js/data/repository/libraryRepository.js';
import { ProfileManager } from './js/core/profile/profileManager.js';
await I18n.init(); ThemeManager.apply();
addonRepository.getInstalledAddons = async () => [];
ProfileManager.getProfiles=async()=>[];
const app = document.querySelector('#test');
let current = { container: app, onKeyDown(){ window.tvKeys++; } };
Router.getCurrentScreen = () => current;
Router.getCurrent = () => 'home';
Router.navigate = async route => { window.activatedRoute = route; };
window.tvKeys = 0; window.clicks = [];
FocusEngine.init();
window.showControls = (profileColor) => {
  current = { container: app, onKeyDown(){ window.tvKeys++; } };
  app.innerHTML = renderDesktopNavigation({ selectedRoute:'home',profile:{activeProfileColorHex:profileColor} }) + '<main><h1>Library</h1><div class="library-view-mode-row"><button class="library-view-mode-button focusable selected" data-choice="saved">Saved</button><button class="library-view-mode-button focusable" data-choice="cloud">Cloud</button><button disabled>Unavailable</button></div><label>Search <input id="query" value="hello"></label><div class="test-cards"><article class="focusable" data-card="one" tabindex="0">First title</article><article class="focusable" data-card="two" tabindex="0">Second title</article></div><button id="open-dialog">Options</button></main>';
  bindDesktopNavigationEvents(app); ScreenUtils.indexFocusables(app);
  app.querySelectorAll('[data-choice], [data-card]').forEach(button => button.onclick=()=>{ window.clicks.push(button.dataset.choice || button.dataset.card); });
  app.querySelector('#open-dialog').onclick = () => {
    const field = document.createElement('label'); field.textContent='Name';
    field.innerHTML += '<input value="hello" id="dialog-input">';
    window.dialog = new NuvioDialog({ title:'Options', content:field, buttons:[
      {label:'Save',key:'save',onAction:()=>{window.clicks.push('save')}},
      {label:'Cancel',key:'cancel',onAction:()=>{window.clicks.push('cancel');window.dialog.destroy();}}
    ]}).mount();
  };
};
function clearScreen(id) {
  current.unbindDesktopPlayerPointerBridge?.();
  if (current === settings) { settings.cleanup(); settings.container=null; }
  app.id=id; app.innerHTML=''; app.style.display='block'; app.onclick=null;
}
window.showSettings = async section => {
  clearScreen('settings'); settings.container=app;
  settings.ensureAccountSyncOverview=()=>{};
  await settings.mount();
  settings.activeSection=section; settings.mobileSectionOpen=true;
  current=settings; await settings.render();
};
window.showTextDialog = async () => {
  settings.openTextDialog({title:'Edit name',value:'Original',onSubmit:async()=>true});
  await settings.render();
};
window.showAuth = () => {
  clearScreen('account'); AuthSignInScreen.container=app; current=AuthSignInScreen;
  AuthSignInScreen.render();
};
const episodes=[1,2,3].map(season=>({id:'fixture:'+season+':1',season,episode:1,title:'Episode one',overview:'Episode description',released:'2026-09-19'}));
const meta={id:'fixture',type:'series',name:'Synthetic series',description:'Local metadata.',videos:episodes};
window.showLibrary = () => {
  clearScreen('library');library.container=app;current=library;
  library.downloadManagerJobs=[];library.downloadedLibrary={supported:false,loading:false,movies:[],series:[]};
  library.controller=new LibraryController();
  Object.assign(library.controller.state,{isLoading:false,visibleItems:[meta],allItems:[meta]});
  library.render();library.bindEvents();
};
window.showSeasons = () => {
  clearScreen('detail');current=detail;
  Object.assign(detail,{container:app,params:{itemId:'fixture',itemType:'series'},meta,episodes,selectedSeason:1,selectedRatingSeason:1,episodeProgressMap:new Map(),watchedEpisodeKeys:new Set(),episodeThumbnailPrefetchCache:new Set(),collectionItems:[],moreLikeThisItems:[],commentsItems:[],localOfflineDownloads:[],seriesInsightTab:'cast',episodeFocusIndexBySeason:{},railFocusIndexByKey:{},isTrailerPlaying:false,trailerPlaybackMode:null,trailerVisualReady:false});
  detail.render(meta);
};
window.showCalendar = async () => {
  clearScreen('calendar');current=calendar;
  libraryRepository.getAll=async()=>[];
  await calendar.mount();
};
window.showSearch = async () => {
  clearScreen('search');current=search;
  search.refreshWatchedTitleIds=async()=>{};
  search.reloadRows=async()=>{search.rows=[];search.render();};
  await search.mount();
};
window.showSources = () => {
  clearScreen('stream');
  const source={id:'fixture-source',name:'Test source',title:'English · 1080p',url:'https://example.org/video.mp4',addonName:'Test addon'};
  const stream=Object.create(StreamScreen);
  Object.assign(stream,{container:app,params:{itemId:'fixture',itemType:'series',itemTitle:'Test series'},
    streams:[source],sourceChips:[{name:'Test addon',status:'success'}],addonFilter:'all',
    focusState:{zone:'filter',filterIndex:0,cardIndex:0,cardAction:'play'},
    getOrderedFilterNames:()=>['Test addon'],getFilteredStreams:()=>[source],hasPendingSourceLoads:()=>false,
    areAddonLogosReady:()=>true,renderContinueWatchingResumeOverlay:()=>'',renderAutoPlayOverlay:()=>'',
    onPointerActivate(node){window.clicks.push(node.dataset.action);}
  });current=stream;stream.render();
};
window.showPlayer = () => {
  clearScreen('player');
  const player = Object.create(PlayerScreen);
  Object.assign(player, {container:app,params:{playerTitle:'Test video'},isExternalFrameMode:()=>false,
    getPlayerHeaderData:()=>({title:'Test video'}),getLoadingOverlayMeta:()=>({title:'Test video'}),
    isDesktopPictureInPictureSupported:()=>false,canOpenInExternalPlayer:()=>false,
    getDesktopVolumeState:()=>({volume:1,muted:false}),getControlDefinitions:()=>[
      {action:'playPause',title:'Play',label:'Play'}, {action:'audioTrack',title:'Audio',label:'Audio'},
      {action:'subtitleDialog',title:'Subtitles',label:'Subtitles'},
      {action:'source',title:'Sources',label:'Sources'}, {action:'speed',title:'Speed',label:'Speed'},
      {action:'episodes',title:'Episodes',label:'Episodes'}, {action:'more',title:'More',label:'More'}],
    hasPrecomputedStreamCandidates:true,streamCandidates:[{id:'source-1',name:'Test source',title:'English',url:'https://example.org/video.mp4',addonName:'Test addon'}],sourceFilter:'all',sourcesFocus:{zone:'filter',index:0},
    getAudioEntries:()=>[{label:'English',selected:true},{label:'French',selected:false}],
    getSubtitleLanguageRailItems:()=>[{key:'en',label:'English',count:1,selected:true}],
    getSelectedSubtitleLanguageKey:()=> 'en',
    getSubtitleOptionsForLanguage:()=>[{title:'English',sourceLabel:'Embedded',selected:true}],
    getPlaybackSpeed:()=>1,getPlaybackSpeedOptions:()=>[0.5,1,1.5,2],
    episodes,episodePanelIndex:0,episodePanelSeason:1,
    discoverEmbeddedSubtitleTracks(){},discoverHiddenAudioTracks(){},syncTrackState(){},applyAudioAmplification(){},
    flushPersistPlayerPresentationSettings(){},
    reloadSources(){window.clicks.push('reload');this.renderSourcesPanel();},
    renderParentalGuideOverlay(){},renderSkipIntroButton(){},renderSeekOverlay(){},renderPauseOverlay(){},
    renderNextEpisodeCard(){},syncPlayerOverlayLayoutState(){},
    bindLoadingLogoFallback(){},updateSkipIntroCountdown(){},resetControlsAutoHide(){},
    revealDesktopPlayerControls(){ this.controlsVisible=true; },
    controlsVisible:true,controlFocusIndex:0,controlFocusZone:'',
    handleBrowserVideoAreaTap(){window.clicks.push('video-tap');},
    seekBrowserPlayerGesture(){window.clicks.push('video-seek');}
  });
  current=player; window.player=player; player.renderPlayerUi();
  player.uiRefs.loadingOverlay.classList.add('hidden');
  player.bindDesktopPlayerPointerBridge();
};
window.showControls(); window.ready=true;
`;
const bundle = (await build({stdin:{contents:script,resolveDir:root},bundle:true,write:false,format:'esm'})).outputFiles[0].text;
const html = `<!doctype html><html lang="en" class="desktop-browser"><head><title>Accessibility test</title><meta name="viewport" content="width=device-width, initial-scale=1">${['base','layout','components','themes','desktop','desktop-theme'].map(n=>`<link rel="stylesheet" href="/css/${n}.css">`).join('')}<style>#test{display:block;position:relative;min-height:100vh}main{padding:140px 32px 32px}.test-cards{display:flex;gap:24px;margin:32px 0}.test-cards article{padding:48px;background:#222}#query{color:#fff;background:#222}#test>button{margin:16px}</style></head><body class="desktop-browser"><div id="app"><div class="screen" id="test"></div></div><script>globalThis.__NUVIO_PLATFORM__='browser';globalThis.__NUVIO_ENV__={NUVIO_SUPABASE_URL:'https://api.nuvio.tv'}</script><script type="module" src="/harness.js"></script></body></html>`;
const server=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/')return res.writeHead(200,{'Content-Type':'text/html'}).end(html);
    if(pathname==='/harness.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(bundle);
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    const mime={'.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf'};
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || (process.platform==='win32'?'chrome':undefined),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
const focused=async selector=>assert.equal(await page.locator(selector).evaluate(el=>el===document.activeElement),true,`Focus: ${selector}; actual: ${await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,250))}`);
const audit=async (name,targetPage=page)=>{
  const {violations}=await new AxeBuilder({page:targetPage}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  assert.deepEqual(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[],name);
  console.log(`${name}: axe passed`);
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('[data-desktop-route="home"]').focus();
  await page.keyboard.press('ArrowRight');await focused('[data-desktop-route="search"]');
  assert.equal(await page.evaluate(()=>window.activatedRoute),undefined);
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.activatedRoute),'search');
  await page.keyboard.press('End');await focused('[data-desktop-route="profileSelection"]');
  await page.keyboard.press('ArrowRight');await focused('[data-desktop-route="home"]');
  await page.locator('[data-choice="saved"]').focus();await page.keyboard.press('ArrowRight');await focused('[data-choice="cloud"]');
  await page.keyboard.press('Space');assert.deepEqual(await page.evaluate(()=>window.clicks),['cloud']);
  await page.locator('#query').focus();await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#query').inputValue(),'helo');
  await page.keyboard.press('Tab');await focused('[data-card="one"]');
  await page.keyboard.press('ArrowRight');await focused('[data-card="two"]');await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.clicks),['cloud','two']);
  await page.locator('#open-dialog').focus();await page.keyboard.press('Enter');
  await page.locator('.nuvio-dialog-button[data-key="save"]').waitFor();
  await page.waitForFunction(()=>document.activeElement?.dataset.key==='save');
  await page.keyboard.press('Tab');await focused('[data-key="cancel"]');
  await page.keyboard.press('Tab');await focused('#dialog-input');
  await page.keyboard.press('Backspace');assert.equal(await page.locator('.nuvio-dialog-backdrop').count(),1);
  await page.keyboard.press('Shift+Tab');await focused('[data-key="cancel"]');
  await audit('Options dialog');
  await page.keyboard.press('Space');await page.waitForFunction(()=>!document.querySelector('.nuvio-dialog-backdrop'));
  await focused('#open-dialog');assert.deepEqual(await page.evaluate(()=>window.clicks),['cloud','two','cancel']);
  await page.locator('#open-dialog').click();
  await page.locator('#dialog-input').click();
  assert.equal(await page.locator('.nuvio-dialog-backdrop').count(),1,'Inside clicks keep dialogs open');
  await page.locator('.nuvio-dialog-backdrop').click({position:{x:8,y:8}});
  await page.locator('.nuvio-dialog-backdrop').waitFor({state:'detached'});
  await focused('#open-dialog');
  await audit('Navigation and cards');
  for(const [background,foreground] of [['#ffffff','rgb(0, 0, 0)'],['#111111','rgb(255, 255, 255)'],['#1E88E5','rgb(0, 0, 0)']]) {
    await page.evaluate(color=>showControls(color),background);
    assert.equal(await page.locator('.desktop-navigation-avatar').evaluate(el=>getComputedStyle(el).color),foreground,'Readable profile initial on '+background);
  }
  for(const section of ['account','profiles','about','appearance','layout','contentDiscovery','integration','streams','playback','downloads','trakt','advanced']) {
    await page.evaluate(section=>showSettings(section),section);await audit(`Settings ${section}`);
  }
  await page.evaluate(()=>showTextDialog());await audit('Settings text dialog');
  await page.locator('[data-text-dialog-role="field"]').fill('Updated');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Backspace');
  assert.equal(await page.locator('[data-text-dialog-role="field"]').inputValue(),'Updatd');
  await page.keyboard.press('Escape');await page.locator('.settings-text-dialog').waitFor({state:'detached'});
  await page.evaluate(()=>showTextDialog());
  await page.locator('.settings-dialog-backdrop').click({position:{x:8,y:8}});
  await page.locator('.settings-text-dialog').waitFor({state:'detached'});
  await page.evaluate(()=>showSearch());await audit('Search');
  await page.evaluate(()=>showLibrary());await audit('Library');
  await page.locator('.library-view-mode-button').first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('library-view-mode-button')),true);
  await page.evaluate(()=>showCalendar());await audit('Calendar');
  const date=await page.locator('[data-calendar-date][tabindex="0"]').getAttribute('data-calendar-date');
  await page.locator('[data-calendar-date][tabindex="0"]').focus();await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.evaluate(()=>document.activeElement.dataset.calendarDate),date);
  await page.evaluate(()=>showSeasons());await audit('Details and seasons');
  await page.locator('.series-season-btn').first().focus();await page.keyboard.press('ArrowRight');
  await focused('.series-season-btn[data-season="2"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.series-season-btn[data-season="2"]')?.classList.contains('selected'));
  assert.equal(await page.locator('.series-season-btn[data-season="2"]').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>showAuth());await audit('Sign in');
  await page.evaluate(()=>showSources());await audit('Sources');
  await page.locator('.stream-route-chip').first().focus();await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>window.clicks.at(-1)),'setFilter');
  await page.locator('[data-action="playStream"]').focus();await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>window.clicks.at(-1)),'playStream');
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>showAuth());await audit('Mobile sign in '+width);
    await page.evaluate(()=>showSettings('account'));await audit('Mobile account '+width);
    await page.evaluate(()=>showLibrary());await audit('Mobile library '+width);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
  }
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>showPlayer());
  await page.locator('[data-action="audioTrack"]').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.activeElement?.dataset.audioIndex==='0');
  await page.keyboard.press('Shift+Tab');await focused('[data-audio-index="1"]');
  await page.keyboard.press('Escape');await focused('[data-action="audioTrack"]');
  await page.locator('[data-action="playPause"]').focus();await page.keyboard.press('Space');
  await focused('[data-action="playPause"]');
  await page.evaluate(()=>player.setControlsVisible(false));
  assert.equal(await page.evaluate(()=>player.controlsVisible),true);
  await audit('Player controls');
  for (const width of [1440,390,844]) {
    const mobile=width!==1440;
    const mobileContext=mobile ? await browser.newContext({hasTouch:true,viewport:{width,height:width===844?390:900},reducedMotion:'reduce'}) : null;
    const playerPage=mobile ? await mobileContext.newPage() : page;
    if(mobile) {
      playerPage.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
      await playerPage.goto(page.url());await playerPage.waitForFunction(()=>window.ready);
    }
    await playerPage.evaluate(()=>showPlayer());
    const panels=[['source','#playerSourcesPanel'],['subtitleDialog','#playerSubtitleDialog'],['audioTrack','#playerAudioDialog'],['speed','#playerSpeedDialog'],['episodes','#episodeSidePanel']];
    if(await playerPage.evaluate(()=>player.isCompactBrowserPlayerToolbar())) panels.push(['more','#playerMobileMorePanel']);
    for (const [action,panel] of panels) {
      await playerPage.locator('[data-action="'+action+'"]').first().click();
      await playerPage.waitForFunction(selector=>document.activeElement?.closest(selector),panel);
      await playerPage.locator(panel+' .player-sources-title, '+panel+' .player-dialog-title, '+panel+' .player-episode-panel-title, '+panel+' .player-mobile-more-title').click();
      assert.equal(await playerPage.locator(panel).evaluate(el=>!el.classList.contains('hidden')),true,'Inside '+action);
      if(action==='source') {
        await playerPage.locator('[data-top-action="reload"]').click();
        assert.equal(await playerPage.evaluate(()=>window.clicks.at(-1)),'reload');
        assert.equal(await playerPage.locator('[data-top-action="reload"]').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','Reload foreground stays white after activation');
      }
      if(action==='speed') {
        assert.equal(await playerPage.locator(panel+' .selected .player-dialog-item-check').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','Selected speed checkmark stays white');
      }
      await audit('Player '+action+' '+width,playerPage);
      if(action==='episodes') {
        await playerPage.evaluate(()=>{player.episodePanelMode='streams';player.episodePanelStreams=[];player.renderEpisodePanel();});
        await audit('Player episode sources '+width,playerPage);
      }
      assert.equal(await playerPage.locator('#playerControlsOverlay').evaluate(el=>el.inert),true,'Background controls stay inert');
      assert.equal(await playerPage.locator('#playerModalBackdrop').evaluate(el=>el.inert),false,'Dismiss backdrop remains clickable');
      const outside=await playerPage.evaluate(()=>{
        for(const y of [8,innerHeight/2,innerHeight-8]) for(const x of [8,innerWidth/2,innerWidth-8]) {
          if(document.elementFromPoint(x,y)?.id==='playerModalBackdrop')return {x,y};
        }
        return null;
      });
      if(outside) {
        if(mobile) await playerPage.touchscreen.tap(outside.x,outside.y);
        else await playerPage.mouse.click(outside.x,outside.y);
      } else {
        // Full-screen phone sheets have no exposed backdrop.
        assert.equal(mobile,true,'Desktop panels must have a dismiss backdrop');
        if(action==='source') await playerPage.locator('[data-top-action="close"]').click();
        else if(action==='episodes') await playerPage.locator('[data-episode-action="close"]').click();
        else await playerPage.keyboard.press('Escape');
      }
      await playerPage.waitForFunction(selector=>!document.querySelector(selector)||document.querySelector(selector).classList.contains('hidden'),panel);
      await playerPage.waitForFunction(()=>!document.querySelector('#playerControlsOverlay').inert);
    }
    assert.equal(await playerPage.evaluate(()=>window.clicks.some(c=>c==='video-tap'||c==='video-seek')),false,'Dismissing a panel must not activate video gestures');
    if(mobile) await mobileContext.close();
  }
  await page.screenshot({path:path.resolve(root,'../accessibility-player-qa.png')});
  assert.deepEqual(errors,[]);
  console.log('Keyboard navigation, native editing, card activation, modal trapping/restoration and player focus passed.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
