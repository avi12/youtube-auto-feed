import { z } from "../../../shared/zod";
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
import { deepArray } from "../../utils/records";
import { isLockupViewModel, isShelfRenderer, isShortsLockupViewModel, isVideoRenderer } from "../../youtube-api/guards";
import { findRichItemIndex } from "../rich-item";
import { mergeLockupViewModel } from "./lockup-model";

// Writes back into Polymer's data binding. A video may appear in the rich grid root, inside one or
// more rich shelves, and inside a legacy inner shelf; syncGridModelItem updates every position so
// Polymer re-renders all copies. applyPolymerUpdate is the preferred entry for element-bound updates.

const objectSchema = z.looseObject({});

const itemDataSchema = z.looseObject({ content: z.unknown() });

const richItemContentSchema = z.looseObject({
  lockupViewModel: z.unknown(),
  shortsLockupViewModel: z.unknown(),
  videoRenderer: z.unknown(),
  gridVideoRenderer: z.unknown(),
  richGridMediaRenderer: z.unknown()
});

const rendererThumbnailSchema = z.looseObject({ thumbnails: z.array(z.unknown()) });

type ApplyPolymerUpdateParams = Prettify<{
  elItem: Prettify<PolymerElement>;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
}>;

export function applyPolymerUpdate({ elItem, rawRenderer }: ApplyPolymerUpdateParams) {
  const parsedItemData = itemDataSchema.safeParse(elItem.data);
  if (!parsedItemData.success) {
    return;
  }

  const itemData = parsedItemData.data;
  const parsedContent = richItemContentSchema.safeParse(itemData.content);
  if (!parsedContent.success) {
    elItem.set("data", rawRenderer);
    return;
  }

  const content = parsedContent.data;
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

  if (objectSchema.safeParse(content.videoRenderer).success) {
    elItem.set("data.content.videoRenderer", rawRenderer);
    return;
  }

  if (objectSchema.safeParse(content.gridVideoRenderer).success) {
    elItem.set("data.content.gridVideoRenderer", rawRenderer);
    return;
  }

  if (objectSchema.safeParse(content.richGridMediaRenderer).success) {
    elItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
  }
}

function isRendererThumbnail(value: unknown): value is InnerTubeVideoRenderer["thumbnail"] {
  return rendererThumbnailSchema.safeParse(value).success;
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

  // Keep the existing thumbnail so the in-flight <img> retains its decoded bytes.
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
  if (objectSchema.safeParse(existingContent.richGridMediaRenderer).success) {
    elElement.set(`${basePath}.richGridMediaRenderer.content.videoRenderer`, rawRenderer);
    return;
  }

  const isLockupApplicable = isLockupViewModel(rawRenderer)
    || objectSchema.safeParse(existingContent.lockupViewModel).success;
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
    || objectSchema.safeParse(existingContent.shortsLockupViewModel).success;
  if (isShortsLockupApplicable) {
    elElement.set(`${basePath}.shortsLockupViewModel`, rawRenderer);
    return;
  }

  const existingGridVideoRenderer = objectSchema.safeParse(existingContent.gridVideoRenderer);
  if (existingGridVideoRenderer.success) {
    elElement.set(
      `${basePath}.gridVideoRenderer`, buildMergedVideoRenderer({
        existing: existingGridVideoRenderer.data,
        incoming: rawRenderer,
        forcePreserveContentImage
      })
    );
    return;
  }

  const existingVideoRenderer = objectSchema.safeParse(existingContent.videoRenderer);
  elElement.set(
    `${basePath}.videoRenderer`, buildMergedVideoRenderer({
      existing: existingVideoRenderer.success ? existingVideoRenderer.data : null,
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
  const isGridUsable = !!elGrid && isPolymerElement(elGrid) && objectSchema.safeParse(elGrid.data).success;
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
    const isRichShelfUsable = isPolymerElement(elShelf) && objectSchema.safeParse(elShelf.data).success;
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
    const isLegacyShelfUsable = isPolymerElement(elShelf) && objectSchema.safeParse(elShelf.data).success;
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

// Update every model position (grid root, rich shelves, legacy shelves) so all DOM copies refresh.
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
