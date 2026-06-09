<script lang="ts">
  const GITHUB_ICON_PATH = "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";
</script>

<footer class="app__footer">
  <a
    class="app__feedback"
    href="https://github.com/avi12/youtube-auto-feed-feedback/issues"
    rel="noopener noreferrer"
    target="_blank">
    <svg class="app__feedback-icon" aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d={GITHUB_ICON_PATH} />
    </svg>
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

  .app__feedback-icon {
    flex: none;
    block-size: 16px;
    inline-size: 16px;
  }

  .app__feedback:hover {
    background-color: color-mix(in sRGB, var(--md-primary) 8%, transparent);
  }

  .app__feedback:focus-visible {
    outline: 3px solid color-mix(in sRGB, var(--md-primary) 50%, transparent);
    outline-offset: 2px;
  }
</style>
