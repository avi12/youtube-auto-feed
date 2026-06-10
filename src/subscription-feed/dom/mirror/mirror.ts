import { isAnimationsEnabled } from "../../settings-state";
import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray } from "../../utils/records";
import { gridDataSchema } from "../../youtube-api/schemas";
import { thumbnailUrlFromRichItem, videoIdFromRichItem } from "../rich-item";
import { collectInlineVideoIds, composeNewContents, isReferenceEqualArray } from "./mirror-compose";
import { findRemovedViewportTiles } from "./mirror-find-tiles";
import { setContentsWithFlip } from "./mirror-flip";
import { createRemovalGhosts } from "./mirror-ghosts";
import { pruneUnsubscribedShelfVideos } from "./mirror-shelf-prune";
import { awaitNewThumbnailsReady, repaintInsertedThumbnails } from "./mirror-thumbnails";

type MirrorFromApiParams = Prettify<{
  apiContents: Prettify<InnerTubeRichGridItem>[];
}>;

export async function mirrorFromApi({ apiContents }: MirrorFromApiParams) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !gridDataSchema.safeParse(elGrid.data).success) {
    return;
  }

  const currentContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  if (currentContents.length === 0) {
    return;
  }

  // Removal spans every band (Latest plus rich shelves); the inline reflow below only handles Latest,
  // so reconcile the shelves here. Runs before the unchanged-inline early return so a video that lives
  // only in a shelf is still pruned.
  pruneUnsubscribedShelfVideos(apiContents);

  const previousInlineIds = collectInlineVideoIds(currentContents);
  const newContents = composeNewContents({
    apiContents,
    currentContents
  });
  if (isReferenceEqualArray(currentContents, newContents)) {
    return;
  }

  const { newlyInsertedIds, newThumbnailUrls } = collectNewlyInsertedTiles(newContents, previousInlineIds);

  repaintInsertedThumbnails(newlyInsertedIds).catch(() => {});

  if (!isAnimationsEnabled()) {
    elGrid.set("data.contents", newContents);
  } else {
    await awaitNewThumbnailsReady(newThumbnailUrls.values());
    const removalGhosts = createRemovalGhosts(findRemovedViewportTiles(newContents));
    await setContentsWithFlip({
      elGrid,
      newContents,
      newlyInsertedIds,
      newThumbnailUrls,
      removalGhosts
    });
  }
}

function collectNewlyInsertedTiles(
  newContents: Prettify<InnerTubeRichGridItem>[],
  previousInlineIds: Set<string>
) {
  const newlyInsertedIds = new Set<string>();
  const newThumbnailUrls = new Map<string, string>();
  for (const item of newContents) {
    const videoId = videoIdFromRichItem(item);
    if (!videoId || previousInlineIds.has(videoId)) {
      continue;
    }

    newlyInsertedIds.add(videoId);
    const thumbnailUrl = thumbnailUrlFromRichItem(item);
    if (thumbnailUrl) {
      newThumbnailUrls.set(videoId, thumbnailUrl);
    }
  }
  return {
    newlyInsertedIds,
    newThumbnailUrls
  };
}
