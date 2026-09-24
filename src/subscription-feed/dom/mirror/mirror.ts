import { isAnimationsEnabled } from "../../settings-state";
import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isRichGridData } from "../../youtube-api/guards";
import { markVideosAsNew, withNewBadges } from "../new-badge/new-badge";
import { thumbnailUrlFromRichItem, videoIdFromRichItem } from "../rich-item";
import { collectInlineVideoIds, composeNewContents, isReferenceEqualArray } from "./mirror-compose";
import { GRID_SELECTOR } from "./mirror-constants";
import { findRemovedViewportTiles } from "./mirror-find-tiles";
import { setContentsWithFlip } from "./mirror-flip";
import { createRemovalGhosts } from "./mirror-ghosts";
import { pruneUnsubscribedShelfVideos } from "./mirror-shelf-prune";
import { awaitNewThumbnailsReady, repaintInsertedThumbnails } from "./mirror-thumbnails";

type MirrorFromApiParams = Prettify<{
  apiContents: Prettify<InnerTubeRichGridItem>[];
  isInitialLoad: boolean;
}>;

export async function mirrorFromApi({ apiContents, isInitialLoad }: MirrorFromApiParams) {
  const elGrid = document.querySelector<PolymerElement>(GRID_SELECTOR);
  if (!elGrid || !isRichGridData(elGrid.data)) {
    return;
  }

  const { contents: currentContents = [] } = elGrid.data;
  if (currentContents.length === 0) {
    return;
  }

  // Removal spans every band (Latest plus rich shelves); the inline reflow below only handles Latest,
  // so reconcile the shelves here. Runs before the unchanged-inline early return so a video that lives
  // only in a shelf is still pruned. Fire-and-forget: it awaits guide and oEmbed lookups, which must
  // not stall the synchronous inline reflow.
  pruneUnsubscribedShelfVideos(apiContents).catch(() => {});

  const previousInlineIds = collectInlineVideoIds(currentContents);
  const composedContents = composeNewContents({
    apiContents,
    currentContents
  });

  const { newlyInsertedIds, newThumbnailUrls } = collectNewlyInsertedTiles({
    newContents: composedContents,
    previousInlineIds
  });
  // The first pass mirrors the feed the page was served with; nothing in it arrived while the user was
  // reading, so that pass only records what the feed already held.
  markVideosAsNew({
    contents: composedContents,
    previousInlineIds,
    isBadgeable: !isInitialLoad
  });

  const newContents = withNewBadges(composedContents);
  // A pass that only added or lapsed a badge leaves the band itself untouched, so it skips the entrance
  // animation, the removal ghosts and the thumbnail wait.
  if (isReferenceEqualArray({
    left: currentContents,
    right: composedContents
  })) {
    if (newContents !== currentContents) {
      elGrid.set("data.contents", newContents);
    }

    return;
  }

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

type CollectNewlyInsertedTilesParams = Prettify<{
  newContents: Prettify<InnerTubeRichGridItem>[];
  previousInlineIds: Set<string>;
}>;

function collectNewlyInsertedTiles({ newContents, previousInlineIds }: CollectNewlyInsertedTilesParams) {
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
