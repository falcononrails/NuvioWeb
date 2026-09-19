import assert from "node:assert/strict";
import { test } from "node:test";

import {
  desktopContinueWatchingShowUnairedNextUp,
  parseDesktopContinueWatchingSettingsPayload,
  patchDesktopContinueWatchingSettingsPayload
} from "./profileSettingsContinueWatchingBridge.js";

globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;
const { hasUsableRemoteProfileSettings, ProfileSettingsSyncService, encodePreferenceValue } = await import("./profileSettingsSyncService.js");

test("hero catalogs restore from the cloud encoding after local settings are cleared", async (t) => {
  const { LocalStore } = await import("../storage/localStore.js");
  const { AuthManager } = await import("../auth/authManager.js");
  const { ProfileManager } = await import("./profileManager.js");
  const { Platform } = await import("../../platform/index.js");
  const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
  const { LayoutPreferences } = await import("../../data/local/layoutPreferences.js");
  const { SyncHydrationState } = await import("./syncHydrationState.js");
  const values = new Map();
  t.mock.method(LocalStore, "get", (key, fallback = null) => values.has(key) ? values.get(key) : fallback);
  t.mock.method(LocalStore, "set", (key, value) => values.set(key, value));
  t.mock.getter(AuthManager, "isAuthenticated", () => true);
  t.mock.method(AuthManager, "getEffectiveUserId", async () => "test-owner");
  t.mock.method(ProfileManager, "getActiveProfileId", () => "1");
  t.mock.method(Platform, "isBrowser", () => true);
  const keys = ["addon:movie:popular", "addon:series:latest"];
  let encoded;
  t.mock.method(SupabaseApi, "rpc", async (name) => {
    assert.equal(name, "sync_pull_profile_settings_blob");
    return { settings_json: { version: 1, features: { layout_settings: { hero_catalog_keys: encoded } } } };
  });
  try {
    for (const payload of [encodePreferenceValue(keys, "hero_catalog_keys", "layout_settings"), { type: "string_set", value: keys }, keys]) {
      values.clear();
      SyncHydrationState.invalidate();
      encoded = payload;
      await ProfileSettingsSyncService.pull(1);
      assert.deepEqual(LayoutPreferences.getForProfile(1).heroCatalogKeys, keys);
    }
    for (const invalid of ["not-json", '{"id":"wrong-shape"}', '[1,null]']) {
      encoded = { type: "string", value: invalid };
      await ProfileSettingsSyncService.pull(1);
      assert.deepEqual(LayoutPreferences.getForProfile(1).heroCatalogKeys, keys);
    }
    encoded = { type: "string", value: "[]" };
    await ProfileSettingsSyncService.pull(1);
    assert.deepEqual(LayoutPreferences.getForProfile(1).heroCatalogKeys, []);
  } finally { SyncHydrationState.invalidate(); }
});

test("projects explicit Desktop Continue Watching booleans without coercion", () => {
  assert.equal(
    desktopContinueWatchingShowUnairedNextUp('{"show_unaired_next_up":true}'),
    true
  );
  assert.equal(
    desktopContinueWatchingShowUnairedNextUp('{"show_unaired_next_up":false}'),
    false
  );
  assert.equal(
    desktopContinueWatchingShowUnairedNextUp('{"show_unaired_next_up":"false"}'),
    null
  );
  assert.equal(desktopContinueWatchingShowUnairedNextUp('{"other":true}'), null);
});

test("handles malformed Desktop Continue Watching payloads without throwing", () => {
  assert.equal(parseDesktopContinueWatchingSettingsPayload("not-json"), null);
  assert.equal(parseDesktopContinueWatchingSettingsPayload("[]"), null);
  assert.equal(parseDesktopContinueWatchingSettingsPayload(null), null);
});

test("patches only show_unaired_next_up and preserves unknown Desktop keys", () => {
  const patched = patchDesktopContinueWatchingSettingsPayload(
    '{"show_unaired_next_up":false,"desktop_only_a":123,"desktop_only_b":"keep"}',
    true
  );
  assert.deepEqual(JSON.parse(patched), {
    show_unaired_next_up: true,
    desktop_only_a: 123,
    desktop_only_b: "keep"
  });
});

test("creates a minimal valid compatibility payload when the Desktop payload is absent or invalid", () => {
  assert.deepEqual(JSON.parse(patchDesktopContinueWatchingSettingsPayload(null, false)), {
    show_unaired_next_up: false
  });
  assert.deepEqual(JSON.parse(patchDesktopContinueWatchingSettingsPayload("not-json", true)), {
    show_unaired_next_up: true
  });
});

test("treats a Desktop-only Continue Watching payload as meaningful remote settings", () => {
  assert.equal(
    hasUsableRemoteProfileSettings({
      version: 1,
      features: {
        continue_watching_settings_payload: '{"show_unaired_next_up":false}'
      }
    }),
    true
  );
});
