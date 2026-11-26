import { storage } from "#imports";

import { defaultSettings, feedSettingsSchema, SETTING_NAMES, SETTING_STORAGE_KEYS } from "./settings";
import { z } from "./zod";

// Only storage-capable contexts (popup, ISOLATED bridge) may import this.
const booleanSettingSchema = z.boolean();

export async function loadStoredSettings() {
  const defaults = defaultSettings();
  const entries = await Promise.all(
    SETTING_NAMES.map(async name => {
      const stored = await storage.getItem(SETTING_STORAGE_KEYS[name]);
      return [name, booleanSettingSchema.catch(defaults[name]).parse(stored)];
    })
  );
  return feedSettingsSchema.parse(Object.fromEntries(entries));
}
