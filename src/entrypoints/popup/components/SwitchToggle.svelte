<script lang="ts">
  import "./switch-toggle.css";

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
