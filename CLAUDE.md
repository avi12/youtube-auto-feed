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

# Layout ordering
`ytd-rich-grid-renderer > #contents` is a flat list mixing two kinds of items:
- **Section markers** (`ytd-rich-section-renderer`) wrapping either a `richShelfRenderer` (rich shelf with inner contents, e.g. `Shorts`, `Most relevant`) or a legacy `shelfRenderer` (header-only label like `Latest` with no inner contents).
- **Video items** (`ytd-rich-item-renderer`) emitted as direct grid siblings.

Band attribution is positional: any root-level video that follows a section header belongs to that section until the next header. The `Latest` band is special - its header is a title-only legacy shelf, and its videos are root siblings rather than nested in a rich shelf. `readSectionTitle` in `dom/band-layout.ts` treats both shelf kinds as boundaries; do not regress to only counting rich shelves.

Four pieces of logic decide order:
1. `captureBandLayout` (`band-layout.ts`) snapshots the initial section order and per-band video counts (`bandCaps`) at page load. Every subsequent poll reconciles against this baseline.
2. `normalizeInitialBandLayout` only relocates orphan band-0 inline videos (videos that appear before any section header at all). Once any header exists, the videos that follow belong to it and stay put.
3. `reorderSections` + `buildSectionOrder` (`sync.ts`) group `data.contents` into blocks (section header + its trailing videos) after each poll, then re-emit them in the desired order: the initial sectionOrder, plus any newly-appearing polled sections inserted relative to their neighbors, plus `applyTailSectionPreference` pushing `Shorts` last.
4. `moveSectionsToTail` is an idempotent post-sync sweep that physically moves `Shorts` to the end of `#contents` if YouTube wedged it between Latest items.

Within-section ordering:
- `repositionVideoInSection` (`dom/reposition.ts`) drops a finished livestream from front-of-band to its time-correct position.
- `moveVideosToFront` (`dom/move.ts`) handles upcoming -> live transitions; live videos lead their band.
- New videos are inserted via `addVideosToGridDom` / `addVideosToDom` (`dom/add/`) at the time-correct index, using `parseSecondsAgo` on the published-time text.
- `reconcileShelfOrders` (`sync.ts`) detects when a rich shelf's video set matches the API but the order differs, and re-emits the shelf contents in API order.

Contract: **baseline = YouTube verbatim; post-poll = baseline + Shorts pinned to tail, all reconciliations relative to that.**

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
