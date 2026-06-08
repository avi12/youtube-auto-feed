import {
  defaultSettings,
  type FeedSettings,
  IS_ANIMATIONS_ENABLED_KEY,
  IS_EXTENSION_ENABLED_KEY
} from "../shared/settings";
import { settingsMessenger } from "../shared/settings-messaging";
import { loadStoredSettings } from "../shared/settings-storage";
import { storage } from "#imports";

// ISOLATED-world bridge: the only context here that can read browser.storage. It loads the stored
// settings, answers the MAIN world's startup pull, and broadcasts every later change so the live
// feed reacts to popup toggles without a reload.
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

    settingsMessenger.onMessage("getSettings", () => currentSettings);

    currentSettings = await loadStoredSettings();

    storage.watch<typeof defaults.isExtensionEnabled>(IS_EXTENSION_ENABLED_KEY, value => {
      currentSettings = {
        isExtensionEnabled: value ?? defaults.isExtensionEnabled,
        isAnimationsEnabled: currentSettings?.isAnimationsEnabled ?? defaults.isAnimationsEnabled
      };
      broadcastSettings();
    });
    storage.watch<typeof defaults.isAnimationsEnabled>(IS_ANIMATIONS_ENABLED_KEY, value => {
      currentSettings = {
        isExtensionEnabled: currentSettings?.isExtensionEnabled ?? defaults.isExtensionEnabled,
        isAnimationsEnabled: value ?? defaults.isAnimationsEnabled
      };
      broadcastSettings();
    });
    broadcastSettings();
  }
});
