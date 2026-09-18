import vm from "node:vm";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { browserSourceWarnings } from "../../../core/player/browserMediaSupport.js";

const playerScreenUrl = new URL("./playerScreen.js", import.meta.url);
const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);
const componentsCssUrl = new URL("../../../../css/components.css", import.meta.url);
const dialogUrl = new URL("../../components/nuvioDialog.js", import.meta.url);

test("browser PlayerScreen retains browser track paths without native TV playback branches", async () => {
  const source = await readFile(playerScreenUrl, "utf8");

  assert.match(source, /schedulePlaybackStallGuard/);
  assert.match(source, /getBrowserAudioTracks/);
  assert.match(source, /setBrowserAudioTrack/);
  assert.match(source, /audiotrackschanged/);
  assert.match(source, /createSubtitleObjectUrl/);
  assert.doesNotMatch(
    source,
    /\b(?:AVPlay|EngineFS|TizenEngineFsService|PalmSystem|webOS\.service|Luna|isWebOS|isTizen|setWebOsEmbedded|setAvPlay)\b/i
  );
});

test("desktop Player Back chrome follows the shared controls-visible state", async () => {
  const [source, desktopCss] = await Promise.all([
    readFile(playerScreenUrl, "utf8"),
    readFile(desktopCssUrl, "utf8")
  ]);

  assert.match(source, /const controlsVisible = Boolean\(this\.controlsVisible\) && !this\.isExternalFrameMode\(\);/);
  assert.match(source, /backButton\.toggleAttribute\("inert", !controlsVisible\);/);
  assert.match(source, /backButton\.setAttribute\("aria-hidden", String\(!controlsVisible\)\);/);
  assert.match(
    desktopCss,
    /#playerUiRoot:not\(\.controls-visible\) \.player-desktop-back-button\s*\{\s*opacity: 0;\s*pointer-events: none;/
  );
});

test("browser Player routes PiP through active-video capability and lifecycle events", async () => {
  const source = await readFile(playerScreenUrl, "utf8");

  assert.match(source, /getBrowserPictureInPictureCapability\(this\.getDesktopPlaybackVideo\(\), document\)/);
  assert.match(source, /enterpictureinpicture/);
  assert.match(source, /leavepictureinpicture/);
  assert.match(source, /webkitpresentationmodechanged/);
  assert.doesNotMatch(source, /navigator\.standalone|display-mode|isPwa|isStandalone/);
  assert.match(source, /markPictureInPictureUnavailableForActivePlayback/);
});

test("manual external playback uses a valid non-wrapping time row and responsive primary landscape actions", async () => {
  const [source, componentsCss, dialogSource] = await Promise.all([
    readFile(playerScreenUrl, "utf8"),
    readFile(componentsCssUrl, "utf8"),
    readFile(dialogUrl, "utf8")
  ]);
  assert.match(source, /validateExternalPlaybackPositionParts/);
  assert.match(source, /desktop-external-player-time-fields/);
  assert.match(source, /desktop-external-player-time-separator/);
  assert.match(source, /durationSeconds: manualDurationMs \/ 1000/);
  assert.match(source, /markBrowserExternalPlaybackFinished\(\{ handoff, controller: PlayerController \}\)/);
  assert.match(source, /desktop-external-player-manual-actions/);
  assert.match(source, /desktop-external-player-manual-keep/);
  assert.match(source, /desktop-external-player-manual-set/);
  assert.match(source, /className: "desktop-external-player-primary desktop-external-player-manual-finish"/);
  assert.match(source, /data-nuvio-dialog-preserve-deletion/);
  assert.match(source, /event\.stopPropagation\(\);/);
  assert.match(dialogSource, /data-nuvio-dialog-preserve-deletion/);
  assert.match(componentsCss, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
  assert.match(componentsCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \{[\s\S]*?gap: 12px;/);
  assert.match(componentsCss, /width: min\(calc\(100vw - 24px\), 520px\);/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \.nuvio-dialog-button \{[\s\S]*?min-width: 0;/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \.desktop-external-player-manual-keep \{\s*grid-column: 1;/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \.desktop-external-player-manual-set \{\s*grid-column: 2;/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \.nuvio-dialog-button\.focused[\s\S]*?transform: none;/);
  assert.match(componentsCss, /nuvio-dialog-button:last-child:nth-child\(3\).*?grid-column: 1 \/ -1;/s);
  assert.match(componentsCss, /desktop-external-player-primary[\s\S]*?background: var\(--secondary-color, #f5f5f5\);/);
});

test("Player external launches bind the optional Push return subscription before handoff", async () => {
  const source = await readFile(playerScreenUrl, "utf8");

  assert.match(source, /import \{ bindBrowserPushReturn \} from "\.\.\/\.\.\/components\/browserPushReturn\.js";/);
  assert.match(source, /await bindBrowserPushReturn\(\{ token: prepared\.handoff\?\.token \}\);\s*launchBrowserExternalPlayer\(\{ href: prepared\.launch\.href \}\);/);
});


test("audio boost does not capture native cross-origin media", async () => {
  const source = await readFile(playerScreenUrl, "utf8");
  const declaration = source.match(/function supportsWebAudioAmplification\(\) \{[\s\S]*?\n\}/)[0];
  const context = { URL, location: { origin: "https://nuvio.example" }, PlayerController: { video: {} } };
  vm.runInNewContext(declaration, context);
  const video = context.PlayerController.video;
  video.currentSrc = "https://cdn.example/movie.mp4";
  assert.equal(context.supportsWebAudioAmplification(), false);
  video.currentSrc = "blob:https://nuvio.example/download";
  assert.equal(context.supportsWebAudioAmplification(), true);
  video.currentSrc = "/movie.mp4";
  assert.equal(context.supportsWebAudioAmplification(), true);
  video.currentSrc = "";
  assert.equal(context.supportsWebAudioAmplification(), false);
});

test("automatic audio recovery requires codec or decoding evidence and only tries once", async () => {
  const source = await readFile(playerScreenUrl, "utf8");
  const method = source.match(/  attemptSilentAudioRecovery\(reason = "silent-audio"\) \{[\s\S]*?\n  \},/)[0];
  const player = { playRequestToken: 1, currentPlaybackUrl: "https://media.example/video.mkv", video: { currentTime: 0, paused: false, canPlayType: () => "" } };
  const screen = vm.runInNewContext(`({${method}})`, { PlayerController: player, browserSourceWarnings });
  screen.compatibilityAvailable = true;
  screen.getCurrentStreamCandidate = () => ({ title: "Pilot" });
  let attempts = 0;
  screen.startCompatibilityPlayback = () => { attempts++; screen.compatibilityAttemptToken = player.playRequestToken; };
  assert.equal(screen.attemptSilentAudioRecovery(), false, "No audio track list is not evidence of silence");
  Object.assign(player.video, { currentTime: 7, webkitVideoDecodedByteCount: 10000, webkitAudioDecodedByteCount: 0 });
  assert.equal(screen.attemptSilentAudioRecovery("progress"), true);
  assert.equal(screen.attemptSilentAudioRecovery("progress"), false);
  assert.equal(attempts, 1);
  player.playRequestToken++;
  player.video.webkitAudioDecodedByteCount = 100;
  assert.equal(screen.attemptSilentAudioRecovery(), false);
  screen.getCurrentStreamCandidate = () => ({ title: "Pilot Dolby Digital Plus" });
  assert.equal(screen.attemptSilentAudioRecovery(), true);
  player.playRequestToken++;
  screen.getCurrentStreamCandidate = () => ({ title: "Pilot" });
  assert.equal(screen.attemptSilentAudioRecovery("error"), true);
  player.playRequestToken++;
  player.compatibility = {};
  assert.equal(screen.attemptSilentAudioRecovery("error"), false, "Do not retry the converted stream");
});

test("preparing audio closes the modal backdrop and cannot cover already started playback", async () => {
  const source = await readFile(playerScreenUrl, "utf8");
  const methods = ["startCompatibilityPlayback", "closeAudioDialog"].map(name =>
    source.match(new RegExp(`  (?:async )?${name}\\(\\) \\{[\\s\\S]*?\\n  \\},`))[0]
  ).join("\n");
  const player = { playRequestToken: 1, video: { paused: false, readyState: 4 } };
  const screen = vm.runInNewContext(`({${methods}})`, { PlayerController: player });
  let backdropVisible = true;
  Object.assign(screen, {
    audioDialogVisible: true, isActiveMountToken: () => true,
    pendingPlaybackRestore: { timeSeconds: 1948 }, getPlaybackCurrentSeconds: () => 0,
    clearStartupError() {}, renderAudioDialog() {}, resetControlsAutoHide() {},
    dismissPauseOverlay() {}, releaseStartupAudioGate() {}, clearPlaybackStallGuard() {},
    updateLoadingVisibility() {}, refreshTrackDialogs() {},
    updateModalBackdrop() { backdropVisible = this.audioDialogVisible; },
    presentStartedPlayback() { this.loadingVisible = false; },
    showStartupError() { assert.fail("Preparation must not use an error overlay"); }
  });
  player.enableCompatibilityPlayback = async (position) => {
    assert.equal(position, 1948, "Preserve resume when recovery starts before metadata");
    assert.equal(backdropVisible, false);
    assert.equal(screen.loadingVisible, true);
  };
  await screen.startCompatibilityPlayback();
  assert.equal(screen.loadingVisible, false);
  assert.equal(screen.compatibilityPending, false);
});

test("error and dialog controls retain their cursor and keyboard activation", async () => {
  const source = await readFile(playerScreenUrl, "utf8");
  const names = ["setControlsVisible", "resetControlsAutoHide", "handleBrowserKeyDown"];
  const methods = names.map(name => source.match(
    new RegExp(`  (?:async )?${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\},`)
  )[0]).join("\n");
  class Element { matches() { return true; } }
  const button = new Element();
  let hiddenCursor = false;
  let hideTimers = 0;
  const screen = vm.runInNewContext(`({${methods}})`, {
    Element, document: { activeElement: button },
    Environment: { isBrowser: () => true },
    setTimeout: () => { hideTimers++; },
    isBackEvent: () => false, isSelectKeyCode: code => code === 13,
    resolveBrowserPlayerShortcutRoute: () => "none"
  });
  Object.assign(screen, {
    container: { classList: { toggle: (_, hidden) => { hiddenCursor = hidden; } } },
    isExternalFrameMode: () => false, isDesktopPlayerFullscreen: () => false,
    isDesktopEditableTarget: () => false, clearControlsAutoHide() {},
    isDialogOpen: () => false, isStartupErrorVisible: () => true
  });
  screen.setControlsVisible(false);
  assert.equal(hiddenCursor, false, "Errors must never hide the pointer");
  screen.controlsVisible = true;
  screen.resetControlsAutoHide();
  assert.equal(hideTimers, 0, "Errors must not auto-hide their controls");
  let activated = null;
  screen.onPointerActivate = target => { activated = target; };
  await screen.handleBrowserKeyDown({ keyCode: 13, target: button });
  assert.equal(activated, button, "Enter uses the same action as a mouse click");
  screen.isStartupErrorVisible = () => false;
  screen.isDialogOpen = () => true;
  screen.setControlsVisible(false);
  assert.equal(hiddenCursor, false, "Source and track panels keep the pointer");
  screen.isDialogOpen = () => false;
  screen.setControlsVisible(false);
  assert.equal(hiddenCursor, true, "Normal playback still hides the pointer");
});
