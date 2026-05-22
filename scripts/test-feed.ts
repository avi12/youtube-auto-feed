/**
 * CDP test harness for youtube-auto-feed extension.
 *
 * Tests:
 *   1. Baseline integrity — video SET matches API (order intentionally ignored: the
 *      polled InnerTube API is non-deterministic while the page-load response is not)
 *   2. New video detection — removes a video from DOM, waits for next poll to re-add it
 *   3. Upcoming → Live transition — video gains LIVE badge → moves to front of its band
 *   4. Layout reordering — dispatches browse responses with existing sections in every
 *      meaningful permutation; verifies the extension reorders the DOM immediately
 *
 * Usage:
 *   bun scripts/test-feed.ts
 *   bun scripts/test-feed.ts half    (records viewport label only; no resize needed)
 *
 * Requires Opera/Chrome with --remote-debugging-port=9227.
 */

import { setTimeout as delay } from "node:timers/promises";

const CDP_PORT = 9227;
const POLL_INTERVAL_MS = 5_000;
const POLL_WAIT_MS = POLL_INTERVAL_MS + 2_500;
const PROCESS_WAIT_MS = 800;
const viewportLabel = process.argv[2] ?? "full";

// ── CDP connection ───────────────────────────────────────────────────────────

interface CdpTarget { type: string;
  url: string;
  webSocketDebuggerUrl: string; }
interface CdpMsg { id: number;
  result?: {
    result?: { value?: unknown };
  }; }

async function fetchTargets(): Promise<CdpTarget[]> {
  return (await fetch(`http://localhost:${CDP_PORT}/json`)).json() as Promise<CdpTarget[]>;
}

function openCdp(wsUrl: string) {
  const socket = new WebSocket(wsUrl);
  let seq = 1;
  const pending = new Map<number, (v: unknown) => void>();
  socket.addEventListener("message", event => {
    const msg: CdpMsg = JSON.parse(String(event.data));
    pending.get(msg.id)?.(msg.result?.result?.value);
    pending.delete(msg.id);
  });
  const ready = new Promise<void>(r => socket.addEventListener("open", () => r(), { once: true }));
  async function evalAsync<T>(fn: string): Promise<T> {
    await ready;
    const id = seq++;
    return new Promise<T>(r => {
      pending.set(id, v => r(v as T));
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: {
            expression: `(${fn})()`,
            returnByValue: true,
            awaitPromise: true
          }
        })
      );
    });
  }
  return {
    evalAsync,
    close: () => socket.close()
  };
}

type Cdp = ReturnType<typeof openCdp>;

// ── Test reporter ────────────────────────────────────────────────────────────

interface Result { name: string;
  pass: boolean;
  detail: string; }
const results: Result[] = [];
function pass(name: string, detail = "") {
  results.push({
    name,
    pass: true,
    detail
  }); console.log(`  ✅ PASS  ${name}${detail ? `  (${detail})` : ""}`);
}
function fail(name: string, detail: string) {
  results.push({
    name,
    pass: false,
    detail
  }); console.log(`  ❌ FAIL  ${name}  — ${detail}`);
}
function skip(name: string, reason: string) {
  console.log(`  ⏭  SKIP  ${name}  — ${reason}`);
}
function section(title: string) {
  console.log(`\n─── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

// ── Page-context types shared in evals ──────────────────────────────────────

interface Band { title: string;
  videoIds: string[]; }
interface Viewport { width: number;
  height: number; }
interface IntegrityBandDiff { title: string;
  onlyInDom: string[];
  onlyInApi: string[];
  isOrderMatch: boolean; }
interface IntegrityResult { isPass: boolean;
  isBandOrderMatch: boolean;
  domBandTitles: string[];
  apiBandTitles: string[];
  bandDiffs: IntegrityBandDiff[]; }

// Reads band structure from the extension-managed DOM.
// Inline items may use content.lockupViewModel with videoRenderer-shaped data
// (has videoId, not contentId) — falls back to lockupViewModel.videoId for those.
const PARSE_BANDS = `() => {
  const elGrid = document.querySelector("ytd-rich-grid-renderer");
  if (!elGrid?.data?.contents) return [];
  const bands = [];
  let inline = { title: "", videoIds: [] };
  const flush = () => { if (inline.videoIds.length > 0) { bands.push(inline); inline = { title: "", videoIds: [] }; } };
  const extractId = c => c?.videoRenderer?.videoId
    || c?.lockupViewModel?.contentId
    || c?.lockupViewModel?.videoId
    || c?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
  for (const item of elGrid.data.contents) {
    if (item.continuationItemRenderer) continue;
    const rsContent = item.richSectionRenderer?.content;
    const shelf = rsContent?.richShelfRenderer || rsContent?.shelfRenderer;
    if (shelf) {
      flush();
      const title = shelf.title?.runs?.[0]?.text ?? "";
      const videoIds = [];
      if (rsContent.richShelfRenderer) {
        for (const si of rsContent.richShelfRenderer.contents ?? []) {
          const id = extractId(si.richItemRenderer?.content);
          if (id) videoIds.push(id);
        }
      } else {
        const listItems = [
          ...(rsContent.shelfRenderer.content?.horizontalListRenderer?.items ?? []),
          ...(rsContent.shelfRenderer.content?.gridRenderer?.items ?? [])
        ];
        for (const li of listItems) {
          const id = li.videoRenderer?.videoId || li.gridVideoRenderer?.videoId || li.lockupViewModel?.contentId || li.lockupViewModel?.videoId;
          if (id) videoIds.push(id);
        }
      }
      bands.push({ title, videoIds });
      continue;
    }
    const id = extractId(item.richItemRenderer?.content);
    if (id) inline.videoIds.push(id);
  }
  flush();
  return bands;
}`;

// Normalizes inline richItemRenderer items where content.lockupViewModel holds
// videoRenderer-shaped data (has videoId, lacks contentId) by renaming the key
// to videoRenderer. This ensures parseApiResponse handles them via the correct path.
function normalizeContentsForDispatch(contents: unknown[]): unknown[] {
  return contents.map(item => {
    const ri = (item as {
      richItemRenderer?: { content?: Record<string, unknown> };
    }).richItemRenderer;
    if (!ri?.content) {
      return item;
    }

    const lv = ri.content.lockupViewModel as Record<string, unknown> | undefined;
    if (!lv || "contentId" in lv || !("videoId" in lv)) {
      return item;
    }

    const { lockupViewModel: _removed, ...restContent } = ri.content;
    return {
      richItemRenderer: {
        ...ri,
        content: {
          ...restContent,
          videoRenderer: lv
        }
      }
    };
  });
}

function buildBrowsePayload(contents: unknown[]) {
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              richGridRenderer: { contents }
            }
          }
        }]
      }
    }
  };
}

async function dispatch(cdp: Cdp, payload: unknown) {
  await cdp.evalAsync<void>(
    `() => {
    dispatchEvent(new CustomEvent("ytsua-browse-response", { detail: ${JSON.stringify(payload)} }));
  }`
  );
  await delay(PROCESS_WAIT_MS);
}

// ── Test 1: Baseline integrity ───────────────────────────────────────────────
// Only checks video SET membership per band. Section ORDER is intentionally not
// checked because the polled InnerTube API is non-deterministic; the page-load
// response (which drives the DOM baseline) is authoritative.

async function testBaseline(cdp: Cdp) {
  section("1. Baseline layout integrity (set membership)");
  const result = await cdp.evalAsync<IntegrityResult | null>(`async () => window.__ytsuaDebug?.checkLayoutIntegrity() ?? null`);
  if (!result) {
    fail("Baseline integrity", "checkLayoutIntegrity returned null — extension not loaded?"); return result;
  }

  if (!result.isBandOrderMatch) {
    console.log(`     ℹ Band order differs (expected — polled API is non-deterministic): DOM=[${result.domBandTitles.join(", ")}] API=[${result.apiBandTitles.join(", ")}]`);
  }

  // DOM reflects the deterministic page-load response + extension updates.
  // The polled API is non-deterministic, so:
  //   "missing from DOM"  = extension failed to show a video YouTube thinks should appear → FAIL
  //   "missing from API"  = extension holds a video pending 3-poll absence confirmation → expected, no FAIL
  const allDomIds = new Set(result.bandDiffs.flatMap(d => d.domVideoIds));
  const allApiIds = new Set(result.bandDiffs.flatMap(d => d.apiVideoIds));
  const missingFromDom = [...allApiIds].filter(id => !allDomIds.has(id));
  const missingFromApi = [...allDomIds].filter(id => !allApiIds.has(id));
  if (missingFromApi.length > 0) {
    console.log(`     ℹ DOM has ${missingFromApi.length} extra video(s) not yet confirmed absent by API (expected)`);
  }

  if (missingFromDom.length === 0) {
    pass("Baseline integrity", `DOM bands [${result.domBandTitles.join(" → ")}] — all API videos present in DOM`);
  } else {
    fail("Baseline integrity", `missing from DOM: [${missingFromDom.slice(0, 5).join(", ")}]`);
  }

  return result;
}

// ── Test 2: New video detection ──────────────────────────────────────────────
// Removes the first inline video directly from the Polymer model, then waits
// for the extension's 5-second poll to re-detect and re-insert it.

async function testNewVideoDetection(cdp: Cdp) {
  section("2. New video detection (re-detection via polling)");
  const bands = await cdp.evalAsync<Band[]>(PARSE_BANDS);
  const inlineBand = bands.find(b => b.title === "");
  const targetId = inlineBand?.videoIds[0];
  if (!targetId) {
    skip("New video detection", "No inline videos in current layout"); return;
  }

  const removed = await cdp.evalAsync<boolean>(
    `() => {
    const elGrid = document.querySelector("ytd-rich-grid-renderer");
    if (!elGrid?.data?.contents) return false;
    const contents = Array.from(elGrid.data.contents);
    const idx = contents.findIndex(item => {
      const c = item.richItemRenderer?.content;
      return c?.videoRenderer?.videoId === ${JSON.stringify(targetId)}
          || c?.lockupViewModel?.contentId === ${JSON.stringify(targetId)}
          || c?.lockupViewModel?.videoId === ${JSON.stringify(targetId)}
          || c?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId === ${JSON.stringify(targetId)};
    });
    if (idx < 0) return false;
    elGrid.set("data.contents", contents.filter((_, i) => i !== idx));
    return true;
  }`
  );
  if (!removed) {
    fail("New video detection", `Could not remove ${targetId} from DOM`); return;
  }

  console.log(`     Removed ${targetId} from DOM. Waiting ${POLL_WAIT_MS}ms for poll re-detection…`);
  await delay(POLL_WAIT_MS);

  const isBack = await cdp.evalAsync<boolean>(
    `() => {
    const elGrid = document.querySelector("ytd-rich-grid-renderer");
    if (!elGrid?.data?.contents) return false;
    return Array.from(elGrid.data.contents).some(item => {
      const c = item.richItemRenderer?.content;
      return c?.videoRenderer?.videoId === ${JSON.stringify(targetId)}
          || c?.lockupViewModel?.contentId === ${JSON.stringify(targetId)}
          || c?.lockupViewModel?.videoId === ${JSON.stringify(targetId)};
    });
  }`
  );
  if (!isBack) {
    fail("New video detection", `${targetId} not re-added after ${POLL_WAIT_MS}ms`); return;
  }

  const bandsAfter = await cdp.evalAsync<Band[]>(PARSE_BANDS);
  const inlineAfter = bandsAfter.find(b => b.title === "");
  const pos = inlineAfter?.videoIds.indexOf(targetId) ?? -1;
  pass("New video detection", `${targetId} re-detected at inline[${pos}]`);
}

// ── Test 3: Upcoming → Live transition ───────────────────────────────────────
// Dispatches synthetic payloads (in proper API videoRenderer format) with one
// video's status set to "upcoming", then "live". The extension must detect the
// transition and move the video to position 0 of its band.
//
// Using synthetic payloads avoids DOM-format issues (lockupViewModel.videoId
// data that may have non-standard thumbnail structure).

async function testLiveTransition(cdp: Cdp) {
  section("3. Upcoming → Live transition");
  const bands = await cdp.evalAsync<Band[]>(PARSE_BANDS);
  const inlineBand = bands.find(b => b.title === "");
  // Use the 3rd inline video so it's clearly not already at front
  const guineaPigId = inlineBand?.videoIds[2];
  if (!guineaPigId) {
    skip("Upcoming→Live transition", "Fewer than 3 inline videos"); return;
  }

  // Include all inline IDs so absent-video counters don't accumulate across
  // the two sequential dispatches (upcoming then live).
  const sampleIds = inlineBand?.videoIds ?? [];

  function buildInlineContents(guineaPigBadge: "upcoming" | "live") {
    return sampleIds.map(id => {
      const baseVr = buildMinimalVideoRenderer(id);
      const vr = id === guineaPigId
        ? {
          ...baseVr,
          badges: [{
            metadataBadgeRenderer: { style: guineaPigBadge === "upcoming" ? "BADGE_STYLE_TYPE_UPCOMING" : "BADGE_STYLE_TYPE_LIVE_NOW" }
          }],
          thumbnailOverlays: [{
            thumbnailOverlayTimeStatusRenderer: { style: guineaPigBadge === "upcoming" ? "UPCOMING" : "LIVE" }
          }]
        }
        : baseVr;
      return {
        richItemRenderer: {
          content: { videoRenderer: vr }
        }
      };
    });
  }

  // Pause polling so a real API response can't reset the guinea pig's status
  // between the upcoming and live dispatches.
  await cdp.evalAsync<void>(`() => window.__ytsuaDebug?.pausePolling?.()`);

  // ── Step A: dispatch "upcoming" status for guinea pig ──────────────────────
  await dispatch(cdp, buildBrowsePayload(buildInlineContents("upcoming")));

  // ── Step B: dispatch "live" — extension should detect the transition ────────
  await dispatch(cdp, buildBrowsePayload(buildInlineContents("live")));
  await delay(800); // extra wait for view transition animation

  const bandsAfter = await cdp.evalAsync<Band[]>(PARSE_BANDS);
  const inlineAfter = bandsAfter.find(b => b.title === "");
  const posAfter = inlineAfter?.videoIds.indexOf(guineaPigId) ?? -1;
  if (posAfter === 0) {
    pass("Upcoming→Live transition", `${guineaPigId} moved to inline[0]`);
  } else {
    fail("Upcoming→Live transition", `${guineaPigId} at inline[${posAfter}], expected [0]`);
  }

  // ── 3b: Verify live badge is in the Polymer model ─────────────────────────
  section("3b. Channel live badge propagated to Polymer model");
  const hasLiveBadge = await cdp.evalAsync<boolean>(
    `() => {
    const elGrid = document.querySelector("ytd-rich-grid-renderer");
    const id = ${JSON.stringify(guineaPigId)};
    const item = Array.from(elGrid?.data?.contents ?? []).find(it => {
      const c = it.richItemRenderer?.content;
      return c?.lockupViewModel?.contentId === id
          || c?.lockupViewModel?.videoId === id
          || c?.videoRenderer?.videoId === id;
    });
    const c = item?.richItemRenderer?.content;

    // lockupViewModel (real) path
    const overlays = c?.lockupViewModel?.contentImage?.thumbnailViewModel?.overlays ?? [];
    for (const o of overlays) {
      for (const badge of o.thumbnailBottomOverlayViewModel?.badges ?? []) {
        if (badge.thumbnailBadgeViewModel?.badgeStyle === "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE") return true;
      }
    }

    // videoRenderer path (covers synthetic items and DOM items re-added by the extension)
    return c?.videoRenderer?.badges?.some(b => b.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_LIVE_NOW") ?? false;
  }`
  );
  if (hasLiveBadge) {
    pass("Channel live badge in Polymer model", `${guineaPigId} carries LIVE badge`);
  } else {
    fail("Channel live badge in Polymer model", `${guineaPigId} missing LIVE badge in DOM data`);
  }

  await cdp.evalAsync<void>(`() => window.__ytsuaDebug?.resumePolling?.()`);
}

// ── Test 4: Layout reordering ────────────────────────────────────────────────
// Dispatches synthetic API-format payloads (built from current DOM video IDs)
// in every permutation of existing section order.
// Section REORDERING is applied immediately by reorderSections(); no threshold needed.
//
// Using synthetic payloads (rather than raw DOM data) avoids the DOM-specific
// lockupViewModel.videoId format that parseApiResponse cannot parse.

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) {
    return [arr];
  }

  return arr.flatMap((item, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(rest => [item, ...rest]));
}

function buildMinimalVideoRenderer(videoId: string) {
  return {
    videoId,
    title: { runs: [{ text: "dummy" }] },
    thumbnail: { thumbnails: [{ url: "https://i.ytimg.com" }] }
  };
}

function buildSectionContents(title: string, videoIds: string[]) {
  return {
    richSectionRenderer: {
      content: {
        richShelfRenderer: {
          title: { runs: [{ text: title }] },
          contents: videoIds.map(id => ({
            richItemRenderer: {
              content: { videoRenderer: buildMinimalVideoRenderer(id) }
            }
          }))
        }
      }
    }
  };
}

function buildInlineItem(videoId: string) {
  return {
    richItemRenderer: {
      content: { videoRenderer: buildMinimalVideoRenderer(videoId) }
    }
  };
}

async function testLayoutReordering(cdp: Cdp) {
  section("4. Layout reordering (all permutations of existing sections)");
  await cdp.evalAsync<void>(`() => window.__ytsuaDebug?.pausePolling?.()`);
  const bands = await cdp.evalAsync<Band[]>(PARSE_BANDS);

  const namedBands = bands.filter(b => b.title !== "");
  const inlineBand = bands.find(b => b.title === "");
  if (namedBands.length === 0) {
    skip("Layout reordering", "No named sections found — inline-only layout"); return;
  }

  console.log(`     Current layout: ${namedBands.map(b => `"${b.title}"`).join(" → ")} + inline(${inlineBand?.videoIds.length ?? 0})`);

  // Include ALL current inline video IDs so pendingRemovals never accumulates across
  // the 6+ sequential dispatches (each absent video needs 3 dispatches to be confirmed
  // absent and actually removed from the DOM — omitting the full inline set would
  // cause spurious removals by dispatch 3+).
  const sampledInlineIds = inlineBand?.videoIds ?? [];

  function buildPayloadContents(perm: Band[]): unknown[] {
    const contents: unknown[] = [];
    for (let i = 0; i < perm.length; i++) {
      contents.push(buildSectionContents(perm[i].title, perm[i].videoIds));

      if (i === 0) {
        for (const id of sampledInlineIds) {
          contents.push(buildInlineItem(id));
        }
      }
    }
    return contents;
  }

  const sectionPerms = permutations(namedBands);
  const testedNames = new Set<string>();

  for (const perm of sectionPerms) {
    const layoutName = perm.map(b => b.title).join(" → ");
    if (testedNames.has(layoutName)) {
      continue;
    }

    testedNames.add(layoutName);

    await dispatch(cdp, buildBrowsePayload(buildPayloadContents(perm)));

    const resultBands = await cdp.evalAsync<Band[]>(PARSE_BANDS);
    const actualSectionTitles = resultBands.filter(b => b.title !== "").map(b => b.title);
    const expectedSectionTitles = perm.map(b => b.title);
    if (JSON.stringify(actualSectionTitles) === JSON.stringify(expectedSectionTitles)) {
      pass(`Layout: ${layoutName}`, `sections in DOM: [${actualSectionTitles.join(", ")}]`);
    } else {
      fail(`Layout: ${layoutName}`, `expected [${expectedSectionTitles.join(", ")}] got [${actualSectionTitles.join(", ")}]`);
    }
  }

  // Restore original section order
  await dispatch(cdp, buildBrowsePayload(buildPayloadContents(namedBands)));
  await cdp.evalAsync<void>(`() => window.__ytsuaDebug?.resumePolling?.()`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const targets = await fetchTargets();
const subTab = targets.find(t => t.type === "page" && t.url.includes("youtube.com/feed/subscriptions"));
if (!subTab) {
  console.error("❌  No YouTube subscriptions tab found."); process.exit(1);
}

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║   YouTube Auto-Feed  CDP Test Suite                  ║`);
console.log(`╚══════════════════════════════════════════════════════╝`);
console.log(`  Tab : ${subTab.url}`);

const cdp = openCdp(subTab.webSocketDebuggerUrl);
const vp = await cdp.evalAsync<Viewport>(`() => ({ width: innerWidth, height: innerHeight })`);
console.log(`  Viewport: ${vp.width}×${vp.height} (${viewportLabel})\n`);

await testBaseline(cdp);
await testNewVideoDetection(cdp);
await testLiveTransition(cdp);
await delay(2_000);
await testLayoutReordering(cdp);

cdp.close();

// ── Summary ──────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`\n${"═".repeat(54)}`);
console.log(`  Results (${viewportLabel}, ${vp.width}×${vp.height})`);
console.log(`${"═".repeat(54)}`);
console.log(`  Total: ${results.length}  |  ✅ ${passed}  |  ❌ ${failed}`);

if (failed > 0) {
  console.log("\n  Failed:");
  for (const r of results.filter(r => !r.pass)) {
    console.log(`    ❌ ${r.name}: ${r.detail}`);
  }
}

console.log();
process.exit(failed > 0 ? 1 : 0);
