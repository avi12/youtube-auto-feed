import {
  defaultSettings,
  type FeedSettings,
  SETTING_NAMES,
  SETTING_STORAGE_KEYS,
  settingChange
} from "../shared/settings";
import { settingsMessenger } from "../shared/settings-messaging";
import { loadStoredSettings } from "../shared/settings-storage";
import { storage } from "#imports";

// ISOLATED-world bridge: the only context with browser.storage access. It answers MAIN's startup
// "getSettings" pull and broadcasts every change so the MAIN-world mirror stays in sync.
export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  runAt: "document_start",
  async main() {
    const defaults = defaultSettings();
    let currentSettings: FeedSettings | null = null;

    function broadcastSettings() {
      if (currentSettings) {
        settingsMessenger.sendMessage("settingsChanged", currentSettings).catch(() => {});
      }
    }

    function applySettingChange(change: Partial<FeedSettings>) {
      currentSettings = {
        ...defaults,
        ...currentSettings,
        ...change
      };
      broadcastSettings();
    }

    settingsMessenger.onMessage("getSettings", () => currentSettings);

    currentSettings = await loadStoredSettings();

    for (const name of SETTING_NAMES) {
      storage.watch<boolean>(SETTING_STORAGE_KEYS[name], value =>
        applySettingChange(settingChange(name, value ?? defaults[name])));
    }
    broadcastSettings();
  }
});
