import { loadStoredSettings } from "../../shared/settings-storage";
import "./popup.css";
import Popup from "./Popup.svelte";
import { mount } from "svelte";

// Load stored values before mounting so the UI renders actual state without flashing defaults.
const { isExtensionEnabled, isAnimationsEnabled } = await loadStoredSettings();

export default mount(Popup, {
  target: document.getElementById("app") ?? document.body,
  props: {
    isExtensionEnabled,
    isAnimationsEnabled
  }
});
