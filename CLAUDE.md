# Purpose
A browser extension that keeps the YouTube subscriptions feed (`/feed/subscriptions`) live: new uploads, status changes (upcoming -> live -> ended), removed videos, and metadata edits show up without a reload.

# Architecture
- Two MAIN-world content scripts on `youtube.com/*`:
  - `src/entrypoints/fetch-interceptor.content.ts` (runAt `document_start`) - mirrors YouTube's own InnerTube `/browse` response for `FEsubscriptions` to the subscriptions-feed monitor over a typed custom-event message channel.
  - `src/entrypoints/main.content/` - everything else. `monitor.ts` owns the polling lifecycle, `api/` parses InnerTube into `VideoSnapshot[]`, `sync.ts` diffs previous vs fresh snapshots into add/remove/reposition/move-to-front/section-move/band-move/metadata-only buckets, `dom/` does Polymer-aware mutations.
- Polling cadence: 5s full feed, 10s metadata-only. Polling pauses while the tab is hidden.

# Constraints
- Page is live YouTube. The extension mutates `ytd-rich-grid-renderer.data.contents` through Polymer's `elGrid.set(path, value)`, never through `innerHTML`.
- InnerTube renderer shapes vary (`videoRenderer`, `lockupViewModel`, `shortsLockupViewModel`, legacy `shelfRenderer` / `gridRenderer`). Always go through the deep accessors and predicates the module exposes; never index into raw shapes.
- **Section structure is read-only.** The extension may only append or remove videos within sections. It must not reorder, move, merge, dismantle, or tail-pin section markers. Whatever section order YouTube emits is what gets rendered, including repeats.
- Dev server: `pnpm dev` is the supported path. It launches Edge through `web-ext-run` and reloads via `runner.reloadAllExtensions()`. Direct `--load-extension` Edge launch with manual `chrome.runtime.reload()` over CDP silently disables the extension on every content-script rebuild.

# Layout ordering
`ytd-rich-grid-renderer > #contents` is a flat list that mixes two kinds of items:
- **Section markers** wrapping either a rich shelf (with inner contents, e.g. `Shorts`, `Most relevant`) or a legacy shelf (header-only label like `Latest` with no inner contents).
- **Video items** emitted as direct grid siblings.

Band attribution is positional: any root-level video that follows a section header belongs to that section until the next header. The `Latest` band is special - its header is a title-only legacy shelf, and its videos are root siblings rather than nested in a rich shelf. Section detection must treat both shelf kinds as boundaries; do not regress to only counting rich shelves.

Within-section ordering (the only ordering the extension is allowed to influence):
- A finished livestream drops from front-of-band to its time-correct position.
- Upcoming -> live transitions move the video to the front of its band; live videos lead.
- New videos are inserted at the time-correct index using parsed seconds-ago from the published-time text.
- When a rich shelf's video set matches the API but the order differs, the shelf contents are re-emitted in API order.

Contract: **section markers stay exactly where YouTube placed them; the extension only adds or removes videos.**

# Stack
- pnpm + tsx (Node)
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
- Index: `i` prefix (e.g. `iItem`), or bare `i` when iterating in a for loop/higher-order function. Exception: indices that come from the YouTube API keep the API's field name.
- Boolean: `is` prefix (e.g. `isLoading`), phrased positively. Use `isEnabled` + `!isEnabled`, never `isDisabled`, `isNotX`, `isMissing`, etc.

# Types
- 100% type safety: no `any`, avoid `unknown` unless absolutely necessary
- Let TypeScript infer variable and function return types - don't annotate explicitly
- Exception: type predicates require an explicit return type

# State comparison (Chrome = ground truth, no extension)
After every change, compare Edge (with extension) vs Chrome (no extension):

1. **Row counts per band** - Each band's video count must match Chrome's. Rows = ceil(count / 3) at 3-column layout.
2. **Video presence per band** - Every video Chrome shows in a band must appear in the same band on Edge. A video in the wrong band counts as missing from the correct band.

Run this script in both browsers to collect the state:
```js
(() => {
  const grid = document.querySelector('ytd-rich-grid-renderer');
  if (!grid?.data) return null;
  const contents = grid.data.contents ?? [];
  const bands = [];
  let currentSection = '';
  let currentInlineIds = null;
  for (const item of contents) {
    const inlineId = item?.richItemRenderer?.content?.videoRenderer?.videoId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.contentId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.videoId
      ?? item?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
    if (inlineId) {
      if (!currentInlineIds) {
        currentInlineIds = [];
        bands.push({ section: currentSection || '(Latest)', ids: currentInlineIds });
      }
      currentInlineIds.push(inlineId);
      continue;
    }
    currentInlineIds = null;
    const shelfTitle = item?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text;
    if (shelfTitle) {
      const shelfIds = (item?.richSectionRenderer?.content?.richShelfRenderer?.contents ?? [])
        .map(i => i?.richItemRenderer?.content?.videoRenderer?.videoId
          ?? i?.richItemRenderer?.content?.lockupViewModel?.contentId
          ?? i?.richItemRenderer?.content?.lockupViewModel?.videoId
          ?? i?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId)
        .filter(Boolean);
      bands.push({ section: shelfTitle, ids: shelfIds });
      currentSection = shelfTitle;
      continue;
    }
    const titleOnly = item?.richSectionRenderer?.content?.shelfRenderer?.title?.runs?.[0]?.text;
    if (titleOnly) currentSection = titleOnly;
  }
  return bands.map(b => ({ section: b.section, count: b.ids.length, ids: b.ids }));
})()
```

Compare output band-by-band: same section names, same counts, Chrome's IDs present in Edge's matching band. Any video in the wrong section is a bug.

# Workflow
- After each modification, run `pnpm lint` across the project
- Commit messages must be short and to the point

# Hardcoded values
- Strings: use enums; if no enum fits, use a descriptive `SCREAMING_SNAKE_CASE` constant
- Numbers: use a descriptive `SCREAMING_SNAKE_CASE` constant
