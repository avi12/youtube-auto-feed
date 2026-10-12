import { defaultSettings, feedSettingsSchema, SETTING_NAMES, SETTING_STORAGE_KEYS } from "./settings";
import { z } from "./zod";
import { storage } from "#imports";

// Only storage-capable contexts (popup, ISOLATED bridge) may import this.
const booleanSettingSchema = z.boolean();

export async function loadStoredSettings() {
  const defaults = defaultSettings();
  const entries = await Promise.all(
    SETTING_NAMES.map(async name => {
      const parsed = booleanSettingSchema.safeParse(await storage.getItem(SETTING_STORAGE_KEYS[name]));
      return [name, parsed.success ? parsed.data : defaults[name]];
    })
  );
  return feedSettingsSchema.parse(Object.fromEntries(entries));
}
