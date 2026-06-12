<script lang="ts">
  import GithubIcon from "./GithubIcon.svelte";
</script>

<footer class="app__footer">
  <a
    class="app__feedback"
    href="https://github.com/avi12/youtube-auto-feed-feedback/issues"
    target="_blank">
    <GithubIcon />
    Send feedback
  </a>
</footer>

<style>
  .app__footer {
    display: flex;
    justify-content: center;
  }

  .app__feedback {
    position: relative;
    display: inline-flex;
    gap: 8px;
    align-items: center;
    padding-block: 8px;
    padding-inline: 16px;
    border-radius: var(--md-corner-full);
    color: var(--md-primary);
    font-weight: 500;
    font-size: 0.875rem;
    line-height: 1.25rem;
    letter-spacing: 0.1px;
    text-decoration: none;
    transition: background-color var(--ytaf-dur-state) var(--md-ease-standard);
  }

  .app__feedback:hover {
    background-color: color-mix(in sRGB, var(--md-primary) 8%, transparent);
  }

  .app__feedback:focus-visible {
    outline: 3px solid color-mix(in sRGB, var(--md-primary) 50%, transparent);
    outline-offset: 2px;
  }
</style>
