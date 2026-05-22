# Purpose
A browser extension that keeps the YouTube subscriptions feed (`/feed/subscriptions`) live: new uploads, status changes (upcoming -> live -> ended), removed videos, and metadata edits show up without a reload.

# Architecture
- Two MAIN-world content scripts on `youtube.com/*`:
  - `src/entrypoints/fetch-interceptor.content.ts` (runAt `document_start`) - mirrors YouTube's own InnerTube `/browse` response for `FEsubscriptions` to a `ytsua-browse-response` custom event.
  - `src/entrypoints/main.content/` - everything else. `monitor.ts` owns the polling lifecycle, `api/` parses InnerTube into `VideoSnapshot[]`, `sync.ts` diffs previous vs fresh snapshots into add/remove/reposition/move-to-front/section-move/band-move/metadata-only buckets, `dom/` does Polymer-aware mutations.
- Polling cadence: 5s full feed, 10s metadata-only. Polling pauses while the tab is hidden.

# Constraints
- Page is live YouTube. The extension mutates `ytd-rich-grid-renderer.data.contents` through Polymer's `elGrid.set(path, value)`, never through `innerHTML`.
- InnerTube renderer shapes vary (`videoRenderer`, `lockupViewModel`, `shortsLockupViewModel`, legacy `shelfRenderer` / `gridRenderer`). Always go through the deep accessors in `helpers.ts` and the predicates in `api/guards.ts`; never index into raw shapes.
- On page load (the initial DOM baseline before any sync), the section order emitted by YouTube must be preserved verbatim, including any repeats. If YouTube returns `Latest -> Most relevant -> Latest -> Shorts`, the extension must render exactly that order, and likewise for any other order. `normalizeInitialBandLayout` only relocates orphan band-0 inline videos (videos before any section header at all); it must never reorder, drop, or merge sections.
- After page load (during polling/sync), `moveSectionsToTail()` in `dom/band-layout.ts` still forces `Shorts` to the tail of `#contents` to handle the case where a later poll wedges Shorts between Latest items. Don't remove without a replacement.
- Dev server: `pnpm dev` (`scripts/dev-server.ts`) is the supported path. It launches Edge through `web-ext-run` and reloads via `runner.reloadAllExtensions()`. Direct `--load-extension` Edge launch with manual `chrome.runtime.reload()` over CDP silently disables the extension on every content-script rebuild.

# Stack
- bun
- WXT extension framework
- TypeScript (100% type safety, let TypeScript infer types)
- @webext-core/messaging for message passing
- Chromium (Chrome, Edge, Opera) + Firefox MV3

# Code style
- Use the `browser` namespace
- Use early returns for readability and maintainability
- Use functional programming
- Use `for-of` instead of `.forEach`
- Use async/await whenever possible
- Use DRY with separation of concerns, prioritizing readability
- Minimize indentations
- Use modern browser and CSS features
- Don't use `window.` prefix
- Avoid `setTimeout` except for polling every 5 seconds
- Avoid comments - prefer descriptive names
- Don't use em dashes - use regular hyphens
- Don't annotate the type on a callback arrow function's parameter when it can be inferred
- Avoid nested try/catch - flatten with early returns or extracted functions
- Apply parallel modifications whenever possible
- Use object destructuring up to one level deep

# Naming conventions
- Variables and functions: `camelCase`, full words (no abbreviations)
- Module-level constants: `SCREAMING_SNAKE_CASE`
- Exception: event handler first parameter is always `e`

## Variable prefixes
- Element: `el` prefix (e.g. `elButton`)
- Index: `i` prefix (e.g. `iItem`), or bare `i` when iterating in a for loop/higher-order function
- Boolean: `is` prefix (e.g. `isLoading`)

# Types
- 100% type safety: no `any`, avoid `unknown` unless absolutely necessary
- Let TypeScript infer variable and function return types - don't annotate explicitly
- Exception: type predicates require an explicit return type

# Workflow
- After each modification, run `pnpm lint` across the project
- Commit messages must be short and to the point

# Hardcoded values
- Strings: use enums; if no enum fits, use a descriptive `SCREAMING_SNAKE_CASE` constant
- Numbers: use a descriptive `SCREAMING_SNAKE_CASE` constant
