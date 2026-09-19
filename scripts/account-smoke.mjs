// node scripts/account-smoke.mjs
// Local synthetic account only; never signs out a user's browser session.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readAppMetadata } from './appMetadata.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../account-qa');
await mkdir(output, {recursive:true});
const app = await readFile(path.join(root,'js/app.js'),'utf8');
// Exercise the app's real auth subscriber without bootstrapping remote services.
const subscriber = app.slice(app.indexOf('  AuthManager.subscribe((state) => {'), app.indexOf('  markBootStage("Checking authentication");'));
assert.ok(subscriber.includes('SIGNED_OUT'));
const script = `
import { Router } from './js/ui/navigation/router.js';
import { AuthManager } from './js/core/auth/authManager.js';
import { AuthState } from './js/core/auth/authState.js';
import { AuthSignInScreen } from './js/ui/screens/account/authSignInScreen.js';
import { SettingsScreen as settings } from './js/ui/screens/settings/settingsScreen.js';
import { Platform } from './js/platform/index.js';
import { I18n } from './js/i18n/index.js';
import { ThemeManager } from './js/ui/theme/themeManager.js';
import { LocalStore } from './js/core/storage/localStore.js';
import { addonRepository } from './js/data/repository/addonRepository.js';
await I18n.init();
ThemeManager.apply();
addonRepository.getInstalledAddons=async()=>[];
settings.ensureAccountSyncOverview=()=>{};
const collect=settings.collectModel.bind(settings);
settings.collectModel=async()=>({...await collect(),accountEmail:'viewer@example.org',accountSyncOverview:{totalAddons:4,totalPlugins:0,totalLibrary:7,totalWatchProgress:55,totalWatchedItems:74,perProfile:[{profileId:1,profileName:'Viewer',avatarColorHex:'#00685c',addons:4,library:7,watchProgress:55,watchedItems:74}]}});
Router.routes={home:{container:document.querySelector('#home'),mount(){this.container.style.display='block'},cleanup(){this.container.style.display='none'}},settings,authSignIn:AuthSignInScreen,authQrSignIn:{mount(){},cleanup(){}}};
Router.init();
AuthManager.state=AuthState.AUTHENTICATED;
const StartupSyncService={stop(){},start(){}};
const ProviderCredentialSyncService={cancelForegroundPull(){}};
const GUEST_QR_BYPASS_KEY='skipAuthQrGate';
let hasSelectedProfileThisSession=true;
const isSignedOutRouteAllowed=()=>false;
const markBootStage=()=>{};
const routeAfterAuthentication=async()=>{};
const ProfileManager={isRememberLastProfileEnabled:()=>false,clearActiveProfile(){}};
${subscriber}
await Router.navigate('home');
await Router.navigate('settings');
window.openSection=async section=>{settings.setActiveSection(section);settings.mobileSectionOpen=true;await settings.render();};
await window.openSection('account');
Object.assign(window,{Router,AuthManager,AuthSignInScreen,settings});
window.ready=true;
`;
const {identity}=await readAppMetadata();
const bundle=(await build({define:{__NUVIO_APP_IDENTITY__:JSON.stringify(identity)},stdin:{contents:script,resolveDir:root},bundle:true,write:false,format:'esm'})).outputFiles[0].text;
const html=`<!doctype html><html class="desktop-browser"><head><meta name="viewport" content="width=device-width, initial-scale=1">${['base','layout','components','themes','desktop','desktop-theme'].map(n=>`<link rel="stylesheet" href="/css/${n}.css">`).join('')}</head><body class="desktop-browser"><div id="app"><div class="screen" id="home">Home</div><div class="screen" id="settings"></div><div class="screen" id="account"></div></div><script type="module" src="/harness.js"></script></body></html>`;
const server=createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/')return res.writeHead(200,{'Content-Type':'text/html'}).end(html);
  if(pathname==='/harness.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(bundle);
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  const mime={'.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'};
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(body);
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/*',route=>/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(route.request().url())||route.request().url().startsWith(url)?route.continue():route.abort());
 await page.goto(url);
 await page.waitForFunction(()=>window.ready);
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.evaluate(()=>Router.suspendedRouteStack.length),1);
 await page.screenshot({animations:'disabled',path:path.join(output,'account-desktop.png')});
 assert.equal(await page.locator('.settings-account-status-value').evaluate(el=>getComputedStyle(el).fontSize),'16px');
 await page.evaluate(()=>openSection('about'));
 assert.match(await page.locator('.settings-about-brand').innerText(),/falcononrails/);
 await page.screenshot({animations:'disabled',path:path.join(output,'about-desktop.png')});
 for(const width of [390,320]) {
  await page.setViewportSize({width,height:844});
  await page.evaluate(()=>openSection('account'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({animations:'disabled',path:path.join(output,'account-'+width+'.png')});
 }
 // First visit to Sign In from a layered Home > Settings route.
 await page.evaluate(()=>localStorage.setItem('skipAuthQrGate','true'));
 await page.locator('[data-focus-key="account:signout"]').click();
 await page.waitForFunction(()=>Router.getCurrent()==='authSignIn');
 assert.equal(await page.evaluate(()=>Router.suspendedRouteStack.length),0);
 assert.equal(await page.locator('#home').isVisible(),false);
 assert.equal(await page.locator('#settings').isVisible(),false);
 assert.equal(await page.evaluate(()=>localStorage.getItem('skipAuthQrGate')),null);
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
 assert.equal(await page.locator('#desktop-auth-email').evaluate(el=>el.validity.valueMissing),true);
 await page.locator('#desktop-auth-email').blur();
 await page.setViewportSize({width:390,height:844});
 await page.locator('.desktop-auth-brand img').evaluate(img=>img.decode());
 await page.screenshot({animations:'disabled',path:path.join(output,'signin-mobile.png')});
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({animations:'disabled',path:path.join(output,'signin-desktop.png')});
 for(const width of [390,768,1440]) {
  await page.setViewportSize({width,height:900});
  const form=await page.locator('.desktop-auth-card').boundingBox();
  assert.ok(Math.abs(form.x+form.width/2-width/2)<1,'Sign In stays centered at '+width);
 }
 await page.locator('#desktop-auth-email').fill('viewer@example.org');
 await page.locator('#desktop-auth-password').fill('synthetic-password');
 await page.getByRole('button',{name:'Show password',exact:true}).click();
 assert.equal(await page.locator('#desktop-auth-password').getAttribute('type'),'text');
 await page.getByRole('button',{name:'Hide password',exact:true}).click();
 await page.evaluate(()=>{window.loginCalls=0;AuthManager.signInWithEmail=async()=>{loginCalls++;await new Promise(resolve=>window.finishLogin=resolve);throw Error('Synthetic rejection');};});
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
 assert.equal(await page.locator('.desktop-auth-submit').isDisabled(),true);
 await page.evaluate(()=>finishLogin());
 await page.getByRole('alert').waitFor();
 assert.equal(await page.locator('#desktop-auth-email').inputValue(),'viewer@example.org');
 assert.equal(await page.locator('#desktop-auth-password').inputValue(),'synthetic-password');
 assert.equal(await page.evaluate(()=>loginCalls),1);
 await page.getByRole('button',{name:'Link with another device'}).click();
 assert.equal(await page.evaluate(()=>Router.getCurrent()),'authQrSignIn');
 assert.equal(await page.evaluate(()=>AuthSignInScreen.desktopPassword),'');
 await page.evaluate(()=>Router.navigate('authSignIn'));
 await page.getByRole('button',{name:'Continue without an account'}).click();
 assert.equal(await page.evaluate(()=>Router.getCurrent()),'home');
 // A second logout must also work after Sign In has already been mounted.
 await page.evaluate(async()=>{AuthManager.state='authenticated';await Router.navigate('settings');await openSection('account');});
 await page.locator('[data-focus-key="account:signout"]').click();
 await page.waitForFunction(()=>Router.getCurrent()==='authSignIn');
 assert.equal(await page.locator('#home').isVisible(),false);
 assert.equal(await page.locator('#desktop-auth-email').inputValue(),'');
 assert.deepEqual(errors,[]);
 console.log('Account smoke passed: first/repeat sign-out, layer cleanup, desktop/mobile layouts, form validation, pending/failure state, password visibility, QR and guest navigation.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
