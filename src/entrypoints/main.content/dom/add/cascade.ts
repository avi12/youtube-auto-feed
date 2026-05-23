import { parseSecondsAgo } from "../../api/guards";
import {
  deepArray,
  deepRecord,
  deepString,
  isPolymerElement,
  isRecord
} from "../../helpers";
import { type VideoSnapshot } from "../../types";
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
  waitForFrames
} from "../animations";
import { type BandLayout, type CapturedBand } from "../band-layout";
import { buildRichItem, preloadThumbnails } from "../build";
import { scheduleLazyEntrance } from "../lazy-update";
import { findItemElement } from "../query";
import { videoIdFromRichItem } from "../rich-item";

function findRichShelfIndices(contents: unknown[]) {
  const indices: number[] = [];
  for (let i = 0; i < contents.length; i++) {
    if (deepRecord(contents[i], "richSectionRenderer", "content", "richShelfRenderer")) {
      indices.push(i);
    }
  }
  return indices;
}

function resolveInlineZone(
  contents: unknown[],
  iZone: number,
  richShelfIndices: number[]
): {
  insertAt: number;
  existingItems: unknown[];
} {
  let zoneStart: number;
  const nextBoundary = richShelfIndices[iZone] ?? contents.length;
  if (iZone === 0) {
    zoneStart = 0;
    while (zoneStart < nextBoundary) {
      if (videoIdFromRichItem(contents[zoneStart])) {
        break;
      }

      if (deepRecord(contents[zoneStart], "richSectionRenderer", "content", "richShelfRenderer")) {
        break;
      }

      zoneStart++;
    }
  } else {
    zoneStart = (richShelfIndices[iZone - 1] ?? -1) + 1;
  }

  // End of zone: before the next richShelf boundary, also trim trailing continuation items
  let zoneEnd = nextBoundary;
  if (richShelfIndices[iZone] === undefined) {
    while (zoneEnd > zoneStart && isRecord(contents[zoneEnd - 1]) && "continuationItemRenderer" in contents[zoneEnd - 1]) {
      zoneEnd--;
    }
  }

  const existingItems = contents.slice(zoneStart, zoneEnd).filter(item => videoIdFromRichItem(item));
  const firstInlineOffset = contents.slice(zoneStart, zoneEnd).findIndex(item => videoIdFromRichItem(item));
  const insertAt = firstInlineOffset >= 0 ? zoneStart + firstInlineOffset : zoneStart;

  return {
    insertAt,
    existingItems
  };
}

function existingItemSecondsAgo(item: unknown) {
  const text = deepString(item, "richItemRenderer", "content", "videoRenderer", "publishedTimeText", "simpleText");
  return text ? parseSecondsAgo(text) : 0;
}

function applyInlineCascade(
  contents: unknown[],
  newVideos: VideoSnapshot[],
  inlineBands: CapturedBand[]
) {
  if (inlineBands.length === 0) {
    return;
  }

  const richShelfIndices = findRichShelfIndices(contents);
  const { insertAt, existingItems } = resolveInlineZone(contents, 0, richShelfIndices);

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
  contents: unknown[],
  newItems: unknown[],
  shelfBands: CapturedBand[]
) {
  const band = shelfBands[0];
  if (!band) {
    return;
  }

  const iSection = contents.findIndex(item =>
    deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text") === band.sectionTitle);
  if (iSection < 0) {
    return;
  }

  const richSection = deepRecord(contents[iSection], "richSectionRenderer");
  const richContent = deepRecord(richSection, "content");
  const richShelf = deepRecord(richContent, "richShelfRenderer");
  if (!richSection || !richContent || !richShelf) {
    return;
  }

  const shelfContents = deepArray(richShelf, "contents");
  contents[iSection] = {
    richSectionRenderer: {
      ...richSection,
      content: {
        ...richContent,
        richShelfRenderer: {
          ...richShelf,
          contents: [...newItems, ...shelfContents]
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
  contents: unknown[];
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

  const inlineVideos = videosToAdd.filter(video => !video.sectionTitle);
  const inlineBands = bandLayout.bands.filter(band => band.kind === "inline");
  const hasInlineCascade = inlineVideos.length > 0 && inlineBands.length > 0;
  if (prefersReducedMotion() || !hasInlineCascade) {
    const contents = [...deepArray(elGrid.data, "contents")];
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
    const contents = [...deepArray(elGrid.data, "contents")];
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

  try {
    await document.startViewTransition(async () => {
      const contents = [...deepArray(elGrid.data, "contents")];
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

  const lazyItems: HTMLElement[] = [];
  for (const video of inlineVideos) {
    const elItem = findItemElement(video.videoId);
    if (elItem && !isInViewport(elItem)) {
      lazyItems.push(elItem);
    }
  }
  scheduleLazyEntrance(lazyItems);
}
