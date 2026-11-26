import type { InnerTubeVideoRenderer } from "@/subscription-feed/types/innertube";
import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { isRichShelfData, isShelfRenderer } from "@/subscription-feed/youtube-api/guards";

import { buildMergedVideoRenderer } from "./merged-video-renderer";
import type { ApplyToContainerParams } from "./polymer-sync-types";

interface ShelfListItem {
  videoRenderer?: InnerTubeVideoRenderer;
  gridVideoRenderer?: InnerTubeVideoRenderer;
}

type FindMatchingRendererKeyParams = Prettify<{
  item: ShelfListItem;
  videoId: string;
}>;

function findMatchingRendererKey({ item, videoId }: FindMatchingRendererKeyParams) {
  if ((item.videoRenderer?.videoId ?? "") === videoId) {
    return "videoRenderer" as const;
  }

  if ((item.gridVideoRenderer?.videoId ?? "") === videoId) {
    return "gridVideoRenderer" as const;
  }

  return null;
}

function matchingShelfEntries({ shelfData, videoId }: { shelfData: PolymerElement["data"]; videoId: string }) {
  const shelfContent = isShelfRenderer(shelfData) ? shelfData.content : undefined;
  const entries = [];
  for (const listKey of ["horizontalListRenderer", "gridRenderer"] as const) {
    const { items = [] } = shelfContent?.[listKey] ?? {};
    for (const [iItem, item] of items.entries()) {
      const rendererKey = findMatchingRendererKey({
        item,
        videoId
      });
      if (rendererKey) {
        entries.push({
          listKey,
          iItem,
          item,
          rendererKey
        });
      }
    }
  }
  return entries;
}

export function applyToLegacyShelfModels({
  videoId,
  rawRenderer,
  isContentImagePreserveForced
}: ApplyToContainerParams) {
  for (const elShelf of document.querySelectorAll<PolymerElement>("ytd-shelf-renderer")) {
    const isLegacyShelfUsable = isRichShelfData(elShelf.data);
    if (!isLegacyShelfUsable) {
      continue;
    }

    for (const { listKey, iItem, item, rendererKey } of matchingShelfEntries({
      shelfData: elShelf.data,
      videoId
    })) {
      elShelf.set(
        `data.content.${listKey}.items.${iItem}.${rendererKey}`,
        buildMergedVideoRenderer({
          existing: item[rendererKey] ?? null,
          incoming: rawRenderer,
          isContentImagePreserveForced
        })
      );
    }
  }
}
