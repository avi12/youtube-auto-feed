import type { FeedSettings } from "./settings";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

// MAIN-world content scripts cannot read browser.storage, so the ISOLATED settings bridge owns
// storage and pushes values across the world boundary through CustomEvents. MAIN pulls the current
// values once on startup ("getSettings") and the bridge broadcasts every later change.
interface SettingsProtocolMap {
  getSettings(): FeedSettings | null;
  settingsChanged(settings: FeedSettings): void;
}

export const settingsMessenger = defineCustomEventMessaging<SettingsProtocolMap>({ namespace: "ytaf-settings" });
