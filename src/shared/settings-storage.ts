import type { Prettify } from "../subscription-feed/types/prettify";
import { defaultSettings, type FeedSettings, IS_ANIMATIONS_ENABLED_KEY, IS_EXTENSION_ENABLED_KEY } from "./settings";
import { z } from "./zod";
import { storage } from "#imports";

// Only storage-capable contexts (popup, ISOLATED bridge) may import this.
type FeedSettingKey = typeof IS_EXTENSION_ENABLED_KEY | typeof IS_ANIMATIONS_ENABLED_KEY;

const booleanSettingSchema = z.boolean();

type ReadBooleanSettingParams = Prettify<{
  key: FeedSettingKey;
  fallback: boolean;
}>;

async function readBooleanSetting({ key, fallback }: ReadBooleanSettingParams) {
  const parsed = booleanSettingSchema.safeParse(await storage.getItem(key));
  return parsed.success ? parsed.data : fallback;
}

export async function loadStoredSettings(): Promise<FeedSettings> {
  const defaults = defaultSettings();
  const [isExtensionEnabled, isAnimationsEnabled] = await Promise.all([
    readBooleanSetting({
      key: IS_EXTENSION_ENABLED_KEY,
      fallback: defaults.isExtensionEnabled
    }),
    readBooleanSetting({
      key: IS_ANIMATIONS_ENABLED_KEY,
      fallback: defaults.isAnimationsEnabled
    })
  ]);
  return {
    isExtensionEnabled,
    isAnimationsEnabled
  };
}
