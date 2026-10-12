<script lang="ts">
  import { type FeedSettings, SETTING_NAMES, SETTING_STORAGE_KEYS } from "../../shared/settings";
  import Footer from "./components/Footer.svelte";
  import Header from "./components/Header.svelte";
  import Section from "./components/Section.svelte";
  import Switch from "./components/Switch.svelte";
  import { storage } from "#imports";
  import { untrack } from "svelte";

  const preloadedSettings: FeedSettings = $props();

  // Props are a one-time preload; untrack so later prop identity churn cannot reset local state.
  const settings = $state(untrack(() => ({ ...preloadedSettings })));

  for (const name of SETTING_NAMES) {
    $effect(() => {
      storage.setItem(SETTING_STORAGE_KEYS[name], settings[name]).catch(() => {});
    });
  }
</script>

<main style:--ytaf-motion-scale={settings.isAnimationsEnabled ? "1" : "0"} class="app">
  <Header />

  <Section label="Settings">
    <Switch
      description="Keep the subscriptions feed updating in real time"
      label="Extension enabled"
      bind:checked={settings.isExtensionEnabled} />
    <Switch
      description="Slide and fade feed changes as they happen"
      label="Animations"
      bind:checked={settings.isAnimationsEnabled} />
  </Section>

  <Footer />
</main>

<style>
  .app {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-block: 20px 22px;
    padding-inline: 16px;
  }
</style>
