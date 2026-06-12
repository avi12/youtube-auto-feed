<script lang="ts">
  interface Props {
    checked: boolean;
  }

  let { checked = $bindable(false) }: Props = $props();
</script>

<span class="switch">
  <input class="switch__input" type="checkbox" bind:checked />
  <span class="switch__track">
    <span class="switch__handle"></span>
  </span>
</span>

<style>
  .switch {
    position: relative;
    flex: none;
    block-size: 32px;
    inline-size: 52px;
  }

  .switch__input {
    position: absolute;
    inset: 0;
    z-index: 1;
    block-size: 100%;
    inline-size: 100%;
    margin: 0;
    opacity: 0%;
    cursor: pointer;
  }

  .switch__track {
    position: absolute;
    inset: 0;
    border: 2px solid var(--md-outline);
    border-radius: var(--md-corner-full);
    background: var(--md-surface-container-highest);
    transition:
      background-color var(--ytaf-dur-position) var(--md-ease-standard),
      border-color var(--ytaf-dur-position) var(--md-ease-standard);
  }

  .switch__handle {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 14px;
    block-size: 16px;
    inline-size: 16px;
    border-radius: var(--md-corner-full);
    background: var(--md-outline);
    transition:
      inset-inline-start var(--ytaf-dur-position) var(--md-ease-overshoot),
      inline-size var(--ytaf-dur-size) var(--md-ease-standard),
      block-size var(--ytaf-dur-size) var(--md-ease-standard),
      background-color var(--ytaf-dur-color) linear;
    translate: -50% -50%;
  }

  .switch__handle::before {
    content: "";
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    block-size: 40px;
    inline-size: 40px;
    border-radius: var(--md-corner-full);
    background: var(--md-on-surface);
    opacity: 0%;
    pointer-events: none;
    transition: opacity var(--ytaf-dur-state) var(--md-ease-standard);
    translate: -50% -50%;
  }

  .switch__input:checked + .switch__track {
    border-color: var(--md-primary);
    background: var(--md-primary);
  }

  .switch__input:checked + .switch__track .switch__handle {
    inset-inline-start: 34px;
    block-size: 24px;
    inline-size: 24px;
    background: var(--md-on-primary);
  }

  .switch__input:checked + .switch__track .switch__handle::before {
    background: var(--md-primary);
  }

  .switch__input:active + .switch__track .switch__handle {
    block-size: 28px;
    inline-size: 28px;
    background: var(--md-on-surface-variant);
  }

  .switch__input:checked:active + .switch__track .switch__handle {
    background: var(--md-primary-container);
  }

  .switch__input:focus-visible + .switch__track .switch__handle::before {
    opacity: var(--md-state-focus);
  }

  .switch__input:active + .switch__track .switch__handle::before {
    opacity: var(--md-state-pressed);
  }

  .switch__input:focus-visible + .switch__track {
    outline: 3px solid var(--md-primary);
    outline-offset: 2px;
  }
</style>
