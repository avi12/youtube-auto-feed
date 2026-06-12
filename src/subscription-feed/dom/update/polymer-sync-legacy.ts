import type { InnerTubeVideoRenderer } from "../../types/innertube";
import { isPolymerElement } from "../../utils/polymer";
import { isShelfRenderer } from "../../youtube-api/guards";
import { richShelfDataSchema } from "../../youtube-api/schemas";
import { buildMergedVideoRenderer } from "./merged-video-renderer";
import type { ApplyToContainerParams } from "./polymer-sync-types";

type ShelfListItem = {
  videoRenderer?: InnerTubeVideoRenderer;
  gridVideoRenderer?: InnerTubeVideoRenderer;
};

function findMatchingRendererKey(item: ShelfListItem, videoId: string) {
  if ((item.videoRenderer?.videoId ?? "") === videoId) {
    return "videoRenderer" as const;
  }

  if ((item.gridVideoRenderer?.videoId ?? "") === videoId) {
    return "gridVideoRenderer" as const;
  }

  return null;
}

export function applyToLegacyShelfModels({ videoId, rawRenderer, forcePreserveContentImage }: ApplyToContainerParams) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    const isLegacyShelfUsable = isPolymerElement(elShelf) && richShelfDataSchema.safeParse(elShelf.data).success;
    if (!isLegacyShelfUsable) {
      continue;
    }

    const shelfData = elShelf.data;
    const shelfContent = isShelfRenderer(shelfData) ? shelfData.content : undefined;
    for (const listKey of ["horizontalListRenderer", "gridRenderer"] as const) {
      const { items = [] } = shelfContent?.[listKey] ?? {};
      for (const [iItem, item] of items.entries()) {
        const rendererKey = findMatchingRendererKey(item, videoId);
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
