import { defaultSettings, type FeedSettings, IS_ANIMATIONS_ENABLED_KEY, IS_EXTENSION_ENABLED_KEY } from "./settings";
import { z } from "./zod";
import { storage } from "#imports";

// Storage is an untrusted boundary: a stale or corrupted entry can hold a non-boolean. Validate
// each read and fall back to the shared defaults so the popup and the ISOLATED bridge never seed
// the feed from a bad value. Owned here because only storage-capable contexts may import it.
type FeedSettingKey = typeof IS_EXTENSION_ENABLED_KEY | typeof IS_ANIMATIONS_ENABLED_KEY;

const booleanSettingSchema = z.boolean();

async function readBooleanSetting(key: FeedSettingKey, fallback: boolean) {
  const parsed = booleanSettingSchema.safeParse(await storage.getItem(key));
  return parsed.success ? parsed.data : fallback;
}

export async function loadStoredSettings(): Promise<FeedSettings> {
  const defaults = defaultSettings();
  const [isExtensionEnabled, isAnimationsEnabled] = await Promise.all([
    readBooleanSetting(IS_EXTENSION_ENABLED_KEY, defaults.isExtensionEnabled),
    readBooleanSetting(IS_ANIMATIONS_ENABLED_KEY, defaults.isAnimationsEnabled)
  ]);
  return {
    isExtensionEnabled,
    isAnimationsEnabled
  };
}
