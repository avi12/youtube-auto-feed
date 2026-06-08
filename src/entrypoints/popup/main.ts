import { defaultSettings, IS_ANIMATIONS_ENABLED_KEY, IS_EXTENSION_ENABLED_KEY } from "../../shared/settings";
import "./popup.css";
import Popup from "./Popup.svelte";
import { storage } from "#imports";
import { mount } from "svelte";

// Preload every stored value before mounting so the UI renders the real state immediately instead
// of flashing defaults, mirroring the youtube-auto-hd popup bootstrap.
const defaults = defaultSettings();
const [isExtensionEnabled, isAnimationsEnabled] = await Promise.all([
  storage.getItem(IS_EXTENSION_ENABLED_KEY, { fallback: defaults.isExtensionEnabled }),
  storage.getItem(IS_ANIMATIONS_ENABLED_KEY, { fallback: defaults.isAnimationsEnabled })
]);

export default mount(Popup, {
  target: document.getElementById("app") ?? document.body,
  props: {
    isExtensionEnabled,
    isAnimationsEnabled
  }
});
