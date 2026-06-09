<script lang="ts">
  import SwitchToggle from "./SwitchToggle.svelte";

  interface Props {
    checked: boolean;
    label: string;
    description?: string;
  }

  let { checked = $bindable(false), label, description }: Props = $props();
</script>

<label class="row">
  <span class="row__text">
    <span class="row__label">{label}</span>
    {#if description}
      <span class="row__description">{description}</span>
    {/if}
  </span>
  <SwitchToggle bind:checked />
</label>

<style>
  .row {
    position: relative;
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 12px 16px;
    border-radius: var(--md-corner-large);
    cursor: pointer;
  }

  .row::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--md-on-surface);
    opacity: 0%;
    pointer-events: none;
    transition: opacity var(--ytaf-dur-state) var(--md-ease-standard);
  }

  .row:hover::before {
    opacity: var(--md-state-hover);
  }

  .row__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-inline-size: 0;
  }

  .row__label {
    color: var(--md-on-surface);
    font-weight: 500;
    font-size: 1rem;
    line-height: 1.5rem;
    letter-spacing: 0.15px;
  }

  .row__description {
    color: var(--md-on-surface-variant);
    font-weight: 400;
    font-size: 0.875rem;
    line-height: 1.25rem;
    letter-spacing: 0.25px;
  }
</style>
