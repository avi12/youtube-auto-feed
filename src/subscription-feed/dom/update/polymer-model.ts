import type {
  InnerTubeRichGridItem,
  InnerTubeRichItemContent,
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray, isRecord } from "../../utils/records";
import { isLockupViewModel, isShelfRenderer, isShortsLockupViewModel, isVideoRenderer } from "../../youtube-api/guards";
import { findRichItemIndex } from "../rich-item";
import { mergeLockupViewModel } from "./lockup-model";

// Writes back into Polymer's data binding so the DOM re-renders. A single video may appear in
// the rich grid root *and* inside one or more rich shelves *and* inside a legacy inner shelf;
// `syncGridModelItem` touches every position so the binding picks them all up. `applyPolymerUpdate`
// is the higher-level entry that handles the actual element-bound update (preferred path).

type ApplyPolymerUpdateParams = Prettify<{
  elItem: Prettify<PolymerElement>;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
}>;

export function applyPolymerUpdate({ elItem, rawRenderer }: ApplyPolymerUpdateParams) {
  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    return;
  }

  const { content } = itemData;
  if (!isRecord(content)) {
    elItem.set("data", rawRenderer);
    return;
  }

  if (isLockupViewModel(content.lockupViewModel) && isLockupViewModel(rawRenderer)) {
    const merged = mergeLockupViewModel({
      existing: content.lockupViewModel,
      incoming: rawRenderer
    });
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup && "lockupViewModel" in elLockup) {
      Object.assign(elLockup, { lockupViewModel: merged });
      return;
    }

    elItem.set("data", {
      ...itemData,
      content: {
        ...content,
        lockupViewModel: merged
      }
    });
    return;
  }

  const isShortsLockupSwap = isShortsLockupViewModel(content.shortsLockupViewModel)
    && isShortsLockupViewModel(rawRenderer);
  if (isShortsLockupSwap) {
    const elShortsLockup = elItem.querySelector<HTMLElement>("yt-shorts-lockup-view-model");
    if (elShortsLockup && "shortsLockupViewModel" in elShortsLockup) {
      Object.assign(elShortsLockup, { shortsLockupViewModel: rawRenderer });
      return;
    }

    elItem.set("data", {
      ...itemData,
      content: {
        ...content,
        shortsLockupViewModel: rawRenderer
      }
    });
    return;
  }

  if (isRecord(content.videoRenderer)) {
    elItem.set("data.content.videoRenderer", rawRenderer);
    return;
  }

  if (isRecord(content.gridVideoRenderer)) {
    elItem.set("data.content.gridVideoRenderer", rawRenderer);
    return;
  }

  if (isRecord(content.richGridMediaRenderer)) {
    elItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
  }
}

function isRendererThumbnail(value: unknown): value is InnerTubeVideoRenderer["thumbnail"] {
  return isRecord(value) && Array.isArray(value.thumbnails);
}

type BuildMergedVideoRendererParams = Prettify<{
  existing: Prettify<InnerTubeVideoRenderer> | Record<string, unknown> | null;
  incoming: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage: boolean;
}>;

function buildMergedVideoRenderer({
  existing,
  incoming,
  forcePreserveContentImage
}: BuildMergedVideoRendererParams) {
  const isMergeable = forcePreserveContentImage && existing !== null && isVideoRenderer(incoming);
  if (!isMergeable) {
    return incoming;
  }

  const { thumbnail } = existing;
  if (!isRendererThumbnail(thumbnail)) {
    return incoming;
  }

  // Preserve the existing thumbnail object so the in-flight <img> keeps its decoded bytes.
  return {
    ...incoming,
    thumbnail
  };
}

type ApplyRichItemContentUpdateParams = Prettify<{
  elElement: PolymerElement;
  basePath: string;
  existingContent: Prettify<InnerTubeRichItemContent> | Record<string, unknown>;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage: boolean;
}>;

function applyRichItemContentUpdate({
  elElement,
  basePath,
  existingContent,
  rawRenderer,
  forcePreserveContentImage
}: ApplyRichItemContentUpdateParams) {
  if (isRecord(existingContent.richGridMediaRenderer)) {
    elElement.set(`${basePath}.richGridMediaRenderer.content.videoRenderer`, rawRenderer);
    return;
  }

  const isLockupApplicable = isLockupViewModel(rawRenderer) || isRecord(existingContent.lockupViewModel);
  if (isLockupApplicable) {
    const existingLockup = existingContent.lockupViewModel;
    const merged = isLockupViewModel(rawRenderer) && isLockupViewModel(existingLockup)
      ? mergeLockupViewModel({
        existing: existingLockup,
        incoming: rawRenderer,
        forcePreserveContentImage
      })
      : rawRenderer;
    elElement.set(`${basePath}.lockupViewModel`, merged);
    return;
  }

  const isShortsLockupApplicable = isShortsLockupViewModel(rawRenderer)
    || isRecord(existingContent.shortsLockupViewModel);
  if (isShortsLockupApplicable) {
    elElement.set(`${basePath}.shortsLockupViewModel`, rawRenderer);
    return;
  }

  if (isRecord(existingContent.gridVideoRenderer)) {
    elElement.set(
      `${basePath}.gridVideoRenderer`, buildMergedVideoRenderer({
        existing: existingContent.gridVideoRenderer,
        incoming: rawRenderer,
        forcePreserveContentImage
      })
    );
    return;
  }

  elElement.set(
    `${basePath}.videoRenderer`, buildMergedVideoRenderer({
      existing: isRecord(existingContent.videoRenderer) ? existingContent.videoRenderer : null,
      incoming: rawRenderer,
      forcePreserveContentImage
    })
  );
}

type ApplyToGridModelParams = Prettify<{
  videoId: string;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage: boolean;
}>;

function applyToGridModel({ videoId, rawRenderer, forcePreserveContentImage }: ApplyToGridModelParams) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  const isGridUsable = !!elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data);
  if (!isGridUsable) {
    return;
  }

  const contents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  const iItem = findRichItemIndex({
    contents,
    videoId
  });
  if (iItem < 0) {
    return;
  }

  const existingContent = contents[iItem]?.richItemRenderer?.content;
  if (existingContent) {
    applyRichItemContentUpdate({
      elElement: elGrid,
      basePath: `data.contents.${iItem}.richItemRenderer.content`,
      existingContent,
      rawRenderer,
      forcePreserveContentImage
    });
  }
}

type ApplyToRichShelfModelsParams = Prettify<{
  videoId: string;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage: boolean;
}>;

function applyToRichShelfModels({ videoId, rawRenderer, forcePreserveContentImage }: ApplyToRichShelfModelsParams) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    const isRichShelfUsable = isPolymerElement(elShelf) && isRecord(elShelf.data);
    if (!isRichShelfUsable) {
      continue;
    }

    const contents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
    const iItem = findRichItemIndex({
      contents,
      videoId
    });
    if (iItem < 0) {
      continue;
    }

    const existingContent = contents[iItem]?.richItemRenderer?.content;
    if (existingContent) {
      applyRichItemContentUpdate({
        elElement: elShelf,
        basePath: `data.contents.${iItem}.richItemRenderer.content`,
        existingContent,
        rawRenderer,
        forcePreserveContentImage
      });
    }
  }
}

type ApplyToLegacyShelfModelsParams = Prettify<{
  videoId: string;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage: boolean;
}>;

function applyToLegacyShelfModels({ videoId, rawRenderer, forcePreserveContentImage }: ApplyToLegacyShelfModelsParams) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    const isLegacyShelfUsable = isPolymerElement(elShelf) && isRecord(elShelf.data);
    if (!isLegacyShelfUsable) {
      continue;
    }

    const shelfData = elShelf.data;
    const shelfContent = isShelfRenderer(shelfData) ? shelfData.content : undefined;
    for (const listKey of ["horizontalListRenderer", "gridRenderer"] as const) {
      type ShelfListItem = {
        videoRenderer?: InnerTubeVideoRenderer;
        gridVideoRenderer?: InnerTubeVideoRenderer;
      };
      const items = deepArray<ShelfListItem>(shelfContent, listKey, "items");
      for (const [iItem, item] of items.entries()) {
        let rendererKey: "videoRenderer" | "gridVideoRenderer" | null = null;
        if ((item.videoRenderer?.videoId ?? "") === videoId) {
          rendererKey = "videoRenderer";
        } else if ((item.gridVideoRenderer?.videoId ?? "") === videoId) {
          rendererKey = "gridVideoRenderer";
        }

        if (!rendererKey) {
          continue;
        }

        elShelf.set(
          `data.content.${listKey}.items.${iItem}.${rendererKey}`, buildMergedVideoRenderer({
            existing: item[rendererKey] ?? null,
            incoming: rawRenderer,
            forcePreserveContentImage
          })
        );
      }
    }
  }
}

// A video may appear in multiple places (e.g. Latest band + a "Most relevant" rich shelf).
// Update every model position so the Polymer data binding refreshes both DOM copies.
type SyncGridModelItemParams = Prettify<{
  videoId: string;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage?: boolean;
}>;

export function syncGridModelItem({
  videoId,
  rawRenderer,
  forcePreserveContentImage = false
}: SyncGridModelItemParams) {
  applyToGridModel({
    videoId,
    rawRenderer,
    forcePreserveContentImage
  });
  applyToRichShelfModels({
    videoId,
    rawRenderer,
    forcePreserveContentImage
  });
  applyToLegacyShelfModels({
    videoId,
    rawRenderer,
    forcePreserveContentImage
  });
}
