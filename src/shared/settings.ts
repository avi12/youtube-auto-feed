import { z } from "./zod";
import type { StorageItemKey } from "wxt/utils/storage";

export const feedSettingsSchema = z.object({
  isExtensionEnabled: z.boolean(),
  isAnimationsEnabled: z.boolean()
});

export type FeedSettings = z.infer<typeof feedSettingsSchema>;

type SettingName = keyof FeedSettings;

export const SETTING_NAMES = feedSettingsSchema.keyof().options;

// Animations follow the device's reduced-motion preference, so they stay local to it; every other
// setting follows the viewer across their browsers.
export const SETTING_STORAGE_KEYS = {
  isExtensionEnabled: "sync:isExtensionEnabled",
  isAnimationsEnabled: "local:isAnimationsEnabled"
} as const satisfies Record<SettingName, StorageItemKey>;

function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function defaultSettings(): FeedSettings {
  return {
    isExtensionEnabled: true,
    isAnimationsEnabled: !prefersReducedMotion()
  };
}

export function settingChange(name: SettingName, value: boolean) {
  const change: Partial<FeedSettings> = {};
  change[name] = value;
  return change;
}
