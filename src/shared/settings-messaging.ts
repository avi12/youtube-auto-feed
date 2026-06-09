import type { FeedSettings } from "./settings";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

// MAIN cannot read browser.storage: the ISOLATED bridge owns storage and relays values via
// CustomEvents. MAIN pulls once on startup ("getSettings"); the bridge pushes every change.
interface SettingsProtocolMap {
  getSettings(): FeedSettings | null;
  settingsChanged(settings: FeedSettings): void;
}

export const settingsMessenger = defineCustomEventMessaging<SettingsProtocolMap>({ namespace: "ytaf-settings" });
