<script lang="ts">
  import { IS_ANIMATIONS_ENABLED_KEY, IS_EXTENSION_ENABLED_KEY } from "../../shared/settings";
  import Footer from "./components/Footer.svelte";
  import Header from "./components/Header.svelte";
  import Section from "./components/Section.svelte";
  import Switch from "./components/Switch.svelte";
  import { storage } from "#imports";
  import { untrack } from "svelte";

  interface Props {
    isExtensionEnabled: boolean;
    isAnimationsEnabled: boolean;
  }

  const preloadedSettings: Props = $props();

  // Props are a one-time preload; untrack so later prop identity churn cannot reset local state.
  let isExtensionEnabled = $state(untrack(() => preloadedSettings.isExtensionEnabled));
  let isAnimationsEnabled = $state(untrack(() => preloadedSettings.isAnimationsEnabled));

  $effect(() => {
    storage.setItem(IS_EXTENSION_ENABLED_KEY, isExtensionEnabled).catch(() => {});
  });

  $effect(() => {
    storage.setItem(IS_ANIMATIONS_ENABLED_KEY, isAnimationsEnabled).catch(() => {});
  });
</script>

<main style:--ytaf-motion-scale={isAnimationsEnabled ? "1" : "0"} class="app">
  <Header />

  <Section label="Settings">
    <Switch
      description="Keep the subscriptions feed updating in real time"
      label="Extension enabled"
      bind:checked={isExtensionEnabled} />
    <Switch
      description="Slide and fade feed changes as they happen"
      label="Animations"
      bind:checked={isAnimationsEnabled} />
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
