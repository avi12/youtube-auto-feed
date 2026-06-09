import {
  defaultSettings,
  type FeedSettings,
  IS_ANIMATIONS_ENABLED_KEY,
  IS_EXTENSION_ENABLED_KEY
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

    storage.watch<boolean>(IS_EXTENSION_ENABLED_KEY, value =>
      applySettingChange({ isExtensionEnabled: value ?? defaults.isExtensionEnabled }));
    storage.watch<boolean>(IS_ANIMATIONS_ENABLED_KEY, value =>
      applySettingChange({ isAnimationsEnabled: value ?? defaults.isAnimationsEnabled }));
    broadcastSettings();
  }
});
