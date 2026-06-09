import { loadStoredSettings } from "../../shared/settings-storage";
import "./popup.css";
import Popup from "./Popup.svelte";
import { mount } from "svelte";

// Load before mounting so the popup renders stored state instead of flashing defaults.
const { isExtensionEnabled, isAnimationsEnabled } = await loadStoredSettings();

mount(Popup, {
  target: document.getElementById("app") ?? document.body,
  props: {
    isExtensionEnabled,
    isAnimationsEnabled
  }
});
