<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label?: string;
    children: Snippet;
  }

  let { label, children }: Props = $props();
</script>

<section class="section">
  {#if label}
    <h2 class="section__label">{label}</h2>
  {/if}
  <div class="section__card">
    {@render children()}
  </div>
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section__label {
    margin: 0;
    padding-inline-start: 12px;
    color: var(--md-primary);
    font-weight: 500;
    font-size: 0.875rem;
    line-height: 1.25rem;
    letter-spacing: 0.1px;
  }

  .section__card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    border-radius: var(--md-corner-extra-large);
    background: var(--md-surface-container);
  }
</style>
