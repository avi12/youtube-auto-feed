export const IS_EXTENSION_ENABLED_KEY = "sync:isExtensionEnabled" as const;
export const IS_ANIMATIONS_ENABLED_KEY = "local:isAnimationsEnabled" as const;

export interface FeedSettings {
  isExtensionEnabled: boolean;
  isAnimationsEnabled: boolean;
}

function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Single source of truth for the storage fallbacks, shared by the popup, the ISOLATED bridge, and
// the MAIN-world live mirror so every context defaults identically.
export function defaultSettings(): FeedSettings {
  return {
    isExtensionEnabled: true,
    isAnimationsEnabled: !prefersReducedMotion()
  };
}
