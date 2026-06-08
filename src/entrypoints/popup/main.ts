import { loadStoredSettings } from "../../shared/settings-storage";
import "./popup.css";
import Popup from "./Popup.svelte";
import { mount } from "svelte";

// Preload every stored value before mounting so the UI renders the real state immediately instead
// of flashing defaults, mirroring the youtube-auto-hd popup bootstrap.
const { isExtensionEnabled, isAnimationsEnabled } = await loadStoredSettings();

export default mount(Popup, {
  target: document.getElementById("app") ?? document.body,
  props: {
    isExtensionEnabled,
    isAnimationsEnabled
  }
});
