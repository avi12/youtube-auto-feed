import { defaultSettings, type FeedSettings } from "../shared/settings";
import { settingsMessenger } from "../shared/settings-messaging";

// MAIN-world live mirror of the user settings. The DOM modules read the getters synchronously while
// reacting to feed changes; the lifecycle wiring subscribes through onSettingsChange. Values default
// to "on" until the ISOLATED bridge delivers the stored values.
type SettingsListener = (settings: FeedSettings) => void;

let currentSettings: FeedSettings = defaultSettings();

const settingsListeners = new Set<SettingsListener>();

function updateSettings(settings: FeedSettings) {
  currentSettings = settings;
  for (const listener of settingsListeners) {
    listener(currentSettings);
  }
}

export function isExtensionEnabled() {
  return currentSettings.isExtensionEnabled;
}

export function isAnimationsEnabled() {
  return currentSettings.isAnimationsEnabled;
}

export function onSettingsChange(listener: SettingsListener) {
  settingsListeners.add(listener);
}

async function requestInitialSettings() {
  try {
    const settings = await settingsMessenger.sendMessage("getSettings");
    if (settings) {
      updateSettings(settings);
    }
  } catch {}
}

export function initSettingsClient() {
  settingsMessenger.onMessage("settingsChanged", ({ data }) => updateSettings(data));
  requestInitialSettings().catch(() => {});
}
