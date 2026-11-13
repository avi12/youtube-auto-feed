import { mount } from "svelte";

import { loadStoredSettings } from "../../shared/settings-storage";
import Popup from "./Popup.svelte";

import "./popup.css";

// Load before mounting so the popup renders stored state instead of flashing defaults.
mount(Popup, {
  target: document.getElementById("app") ?? document.body,
  props: await loadStoredSettings()
});
