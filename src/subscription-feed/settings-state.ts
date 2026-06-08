import { defaultSettings, type FeedSettings, feedSettingsSchema } from "../shared/settings";
import { settingsMessenger } from "../shared/settings-messaging";

// MAIN-world mirror of user settings. DOM modules read the getters synchronously; lifecycle wiring
// subscribes via onSettingsChange. Defaults to "on" until the ISOLATED bridge delivers stored values.
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

function applyIncomingSettings(data: unknown) {
  const parsed = feedSettingsSchema.safeParse(data);
  if (parsed.success) {
    updateSettings(parsed.data);
  }
}

async function requestInitialSettings() {
  try {
    applyIncomingSettings(await settingsMessenger.sendMessage("getSettings"));
  } catch {}
}

export function initSettingsClient() {
  settingsMessenger.onMessage("settingsChanged", ({ data }) => applyIncomingSettings(data));
  requestInitialSettings().catch(() => {});
}
