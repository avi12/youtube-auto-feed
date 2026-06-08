import { z } from "./zod";

export const IS_EXTENSION_ENABLED_KEY = "sync:isExtensionEnabled" as const;
export const IS_ANIMATIONS_ENABLED_KEY = "local:isAnimationsEnabled" as const;

export const feedSettingsSchema = z.object({
  isExtensionEnabled: z.boolean(),
  isAnimationsEnabled: z.boolean()
});

export type FeedSettings = z.infer<typeof feedSettingsSchema>;

function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Shared fallbacks - popup, ISOLATED bridge, and MAIN-world mirror all default identically.
export function defaultSettings(): FeedSettings {
  return {
    isExtensionEnabled: true,
    isAnimationsEnabled: !prefersReducedMotion()
  };
}
