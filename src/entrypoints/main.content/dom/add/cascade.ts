import { isRichShelfRenderer, parseSecondsAgo } from "../../api/guards";
import { deepArray, deepRecord, isPolymerElement, isRecord } from "../../helpers";
import { type InnerTubeRichGridItem, type VideoSnapshot } from "../../types";
import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  calculateStaggerDelayMs,
  clearAllItemViewTransitionNames,
  extractAnimateIds,
  filterToViewport,
  isInViewport,
  prefersReducedMotion,
  reassignTransitionNames,
  waitForFrames,
  withViewTransitionLock
} from "../animations";
import { type BandLayout, type CapturedBand } from "../band-layout";
import { buildRichItem, preloadThumbnails } from "../build";
import { scheduleLazyEntrance } from "../lazy-update";
import { findItemElement } from "../query";
import { videoIdFromRichItem } from "../rich-item";

const RICHSHELF_COLUMNS = 3;

function findFirstRichShelfIndex(contents: InnerTubeRichGridItem[]) {
  for (let i = 0; i < contents.length; i++) {
    if (deepRecord(contents[i], "richSectionRenderer", "content", "richShelfRenderer")) {
      return i;
    }
  }
  return contents.length;
}

function findInlineZoneStart(contents: InnerTubeRichGridItem[], boundary: number) {
  for (let i = 0; i < boundary; i++) {
    if (videoIdFromRichItem(contents[i])) {
      return i;
    }

    if (deepRecord(contents[i], "richSectionRenderer", "content", "richShelfRenderer")) {
      return i;
    }
  }
  return boundary;
}

function isContinuationItem(item: InnerTubeRichGridItem) {
  return isRecord(item) && "continuationItemRenderer" in item;
}

function trimTrailingContinuations(contents: InnerTubeRichGridItem[], floor: number) {
  let end = contents.length;
  while (end > floor && isContinuationItem(contents[end - 1])) {
    end--;
  }
  return end;
}

function resolveInlineZone(contents: InnerTubeRichGridItem[]): {
  insertAt: number;
  existingItems: InnerTubeRichGridItem[];
} {
  const firstShelfIndex = findFirstRichShelfIndex(contents);
  const zoneStart = findInlineZoneStart(contents, firstShelfIndex);
  const zoneEnd = firstShelfIndex < contents.length
    ? firstShelfIndex
    : trimTrailingContinuations(contents, zoneStart);

  const zoneSlice = contents.slice(zoneStart, zoneEnd);
  const firstInlineOffset = zoneSlice.findIndex(item => videoIdFromRichItem(item));
  if (firstInlineOffset < 0) {
    return {
      insertAt: zoneStart,
      existingItems: []
    };
  }

  return {
    insertAt: zoneStart + firstInlineOffset,
    existingItems: zoneSlice.filter(item => videoIdFromRichItem(item))
  };
}

function existingItemSecondsAgo(item: InnerTubeRichGridItem) {
  const vrText = item?.richItemRenderer?.content?.videoRenderer?.publishedTimeText?.simpleText ?? "";
  if (vrText) {
    return parseSecondsAgo(vrText);
  }

  const lvText = item?.richItemRenderer?.content?.lockupViewModel?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[1]?.metadataParts?.[1]?.text?.content ?? "";
  if (lvText) {
    return parseSecondsAgo(lvText);
  }

  return 0;
}

function applyInlineCascade(
  contents: InnerTubeRichGridItem[],
  newVideos: VideoSnapshot[],
  inlineBands: CapturedBand[]
) {
  if (inlineBands.length === 0) {
    return;
  }

  const { insertAt, existingItems } = resolveInlineZone(contents);

  const merged = [...existingItems];
  for (const video of newVideos) {
    const secondsAgo = parseSecondsAgo(video.publishedTimeText);
    const pos = merged.findIndex(existing => existingItemSecondsAgo(existing) >= secondsAgo);
    const builtItem = buildRichItem(video.rawRenderer);
    if (pos === -1) {
      merged.push(builtItem);
    } else {
      merged.splice(pos, 0, builtItem);
    }
  }

  contents.splice(insertAt, existingItems.length, ...merged);
}

function applyRichShelfCascade(
  contents: InnerTubeRichGridItem[],
  newItems: InnerTubeRichGridItem[],
  shelfBands: CapturedBand[]
) {
  const band = shelfBands[0];
  if (!band) {
    return;
  }

  const iSection = contents.findIndex(item =>
    (item?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ?? "") === band.sectionTitle);
  if (iSection < 0) {
    return;
  }

  const richSection = deepRecord(contents[iSection], "richSectionRenderer");
  const richContent = deepRecord(richSection, "content");
  const richShelfRaw = deepRecord(richContent, "richShelfRenderer");
  if (!richSection || !richContent || !richShelfRaw || !isRichShelfRenderer(richShelfRaw)) {
    return;
  }

  const shelfContents = richShelfRaw.contents;
  const totalDesired = shelfContents.length + newItems.length;
  const alignedTotal = Math.max(shelfContents.length, Math.floor(totalDesired / RICHSHELF_COLUMNS) * RICHSHELF_COLUMNS);
  const acceptedNewItems = newItems.slice(0, alignedTotal - shelfContents.length);

  contents[iSection] = {
    richSectionRenderer: {
      ...richSection,
      content: {
        ...richContent,
        richShelfRenderer: {
          ...richShelfRaw,
          contents: [...acceptedNewItems, ...shelfContents]
        }
      }
    }
  };
}

function applyCascades({
  contents,
  videosToAdd,
  bandLayout,
  inlineVideos,
  inlineBands
}: {
  contents: InnerTubeRichGridItem[];
  videosToAdd: VideoSnapshot[];
  bandLayout: BandLayout;
  inlineVideos: VideoSnapshot[];
  inlineBands: CapturedBand[];
}) {
  if (inlineVideos.length > 0 && inlineBands.length > 0) {
    applyInlineCascade(contents, inlineVideos, inlineBands);
  }

  const shelfSectionTitles = new Set(
    videosToAdd.filter(video => !!video.sectionTitle).map(video => video.sectionTitle)
  );
  for (const sectionTitle of shelfSectionTitles) {
    const shelfBands = bandLayout.bands.filter(band => band.kind === "richShelf" && band.sectionTitle === sectionTitle);
    if (shelfBands.length === 0) {
      continue;
    }

    const sectionVideos = videosToAdd.filter(video => video.sectionTitle === sectionTitle);
    applyRichShelfCascade(contents, sectionVideos.map(video => buildRichItem(video.rawRenderer)), shelfBands);
  }
}

export async function cascadeInsertVideos({
  videosToAdd,
  bandLayout
}: {
  videosToAdd: VideoSnapshot[];
  bandLayout: BandLayout;
}) {
  if (videosToAdd.length === 0) {
    return;
  }

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  await preloadThumbnails(videosToAdd);

  const inlineVideos = videosToAdd.filter(video => !video.sectionTitle && video.bandIndex === 0);
  const inlineBands = bandLayout.bands.filter(band => band.kind === "inline");
  const hasInlineCascade = inlineVideos.length > 0 && inlineBands.length > 0;
  if (prefersReducedMotion() || !hasInlineCascade) {
    const contents = [...deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")];
    applyCascades({
      contents,
      videosToAdd,
      bandLayout,
      inlineVideos,
      inlineBands
    });
    elGrid.set("data.contents", contents);
    return;
  }

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  if (!elGridContents) {
    const contents = [...deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")];
    applyCascades({
      contents,
      videosToAdd,
      bandLayout,
      inlineVideos,
      inlineBands
    });
    elGrid.set("data.contents", contents);
    return;
  }

  clearAllItemViewTransitionNames();

  const elAllInlineItems = [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")];
  const elShiftTargets = filterToViewport(elAllInlineItems);
  const animateIds = extractAnimateIds(elShiftTargets);
  assignItemViewTransitionNames(elShiftTargets);

  const elShiftStyle = buildShiftTransitionStyle({
    elItems: elShiftTargets,
    excludeNames: new Set(),
    delayPerItemMs: calculateStaggerDelayMs(elShiftTargets.length)
  });
  document.head.append(elShiftStyle);

  let elNewItemStyle: HTMLStyleElement | null = null;

  await withViewTransitionLock(async () => {
    try {
      await document.startViewTransition(async () => {
        const contents = [...deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")];
        applyCascades({
          contents,
          videosToAdd,
          bandLayout,
          inlineVideos,
          inlineBands
        });
        elGrid.set("data.contents", contents);

        await waitForFrames({ predicate: () => inlineVideos.every(video => findItemElement(video.videoId)) });

        for (const elItem of elShiftTargets) {
          if (elItem.tagName === "YTD-RICH-ITEM-RENDERER") {
            elItem.style.viewTransitionName = "";
          }
        }

        reassignTransitionNames({
          elItems: elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer"),
          animateIds
        });

        const elNewViewportItems: HTMLElement[] = [];
        for (const video of inlineVideos) {
          const elItem = findItemElement(video.videoId);
          if (elItem && isInViewport(elItem)) {
            elItem.style.viewTransitionName = `ytsua-item-${video.videoId}`;
            elNewViewportItems.push(elItem);
          }
        }

        if (elNewViewportItems.length > 0) {
          elNewItemStyle = buildNewItemTransitionStyle(elNewViewportItems);
          document.head.append(elNewItemStyle);
        }
      }).finished;
    } finally {
      elShiftStyle.remove();
      elNewItemStyle?.remove();
      clearAllItemViewTransitionNames();
    }
  });

  const lazyItems: HTMLElement[] = [];
  for (const video of inlineVideos) {
    const elItem = findItemElement(video.videoId);
    if (elItem && !isInViewport(elItem)) {
      lazyItems.push(elItem);
    }
  }
  scheduleLazyEntrance(lazyItems);
}
