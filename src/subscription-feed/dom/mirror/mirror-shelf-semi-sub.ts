import { isSemiSubscribedRichItem, videoIdFromRichItem } from "@/subscription-feed/dom/rich-item";
import { isAnimationsEnabled } from "@/subscription-feed/settings-state";
import type { InnerTubeRichGridItem } from "@/subscription-feed/types/innertube";
import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { isRichShelfData } from "@/subscription-feed/youtube-api/guards";
import { textFromInnerTubeText } from "@/subscription-feed/youtube-api/renderer-fields";

import { usableShelves } from "./mirror-elements";
import { alignOpenMenuToItsVideo } from "./mirror-open-menu";
import { animateShelfWrite } from "./mirror-shelf-write";

// YouTube Semi-Subscribe lists videos from channels the viewer is not subscribed to, and owns whether
// they stay listed. The shelf mirror never adds to a shelf and never trusts absence, so its tagged videos
// are mirrored here: one joins a shelf when the response lists it there, right after its nearest listed
// neighbour, and leaves once that same shelf in the response stops listing it. It also hides videos of
// subscribed channels, naming them in the response, and those leave every shelf at once. Shelves pair up
// by title and occurrence, since YouTube may emit a title more than once.

type RichGridItem = Prettify<InnerTubeRichGridItem>;

type ShelfMerge = Prettify<{
  contents: RichGridItem[];
  removedVideoIds: Set<string>;
  insertedVideoIds: Set<string>;
}>;

function groupByTitle<TValue>(
  entries: {
    title: string;
    value: TValue;
  }[]
) {
  const groups = new Map<string, TValue[]>();
  for (const { title, value } of entries) {
    groups.set(title, [...(groups.get(title) ?? []), value]);
  }
  return groups;
}

function apiShelvesByTitle(apiContents: RichGridItem[]) {
  return groupByTitle(
    apiContents.flatMap(item => {
      const richShelf = item.richSectionRenderer?.content?.richShelfRenderer;
      return richShelf
        ? [
            {
              title: textFromInnerTubeText(richShelf.title),
              value: richShelf.contents
            }
          ]
        : [];
    })
  );
}

function domShelvesByTitle() {
  return groupByTitle(
    usableShelves().flatMap(elShelf =>
      isRichShelfData(elShelf.data)
        ? [
            {
              title: textFromInnerTubeText(elShelf.data.title),
              value: elShelf
            }
          ]
        : []
    )
  );
}

function containsVideo({ contents, videoId }: { contents: RichGridItem[]; videoId: string }) {
  return contents.some(item => videoIdFromRichItem(item) === videoId);
}

type InsertionIndexParams = Prettify<{
  contents: RichGridItem[];
  apiContents: RichGridItem[];
  iApiItem: number;
}>;

function insertionIndex({ contents, apiContents, iApiItem }: InsertionIndexParams) {
  const neighbourIds = apiContents.slice(0, iApiItem).map(videoIdFromRichItem).reverse();
  for (const neighbourId of neighbourIds) {
    const iNeighbour = contents.findIndex(item => !!neighbourId && videoIdFromRichItem(item) === neighbourId);
    if (iNeighbour !== -1) {
      return iNeighbour + 1;
    }
  }
  return 0;
}

// A shelf the response left out says nothing about the tagged videos in it, but a hidden video goes
// wherever it is.
type MergeShelfParams = Prettify<{
  currentContents: RichGridItem[];
  apiContents: RichGridItem[] | undefined;
  hiddenVideoIds: Set<string>;
}>;

function mergeSemiSubscribedVideos({ currentContents, apiContents = [], hiddenVideoIds }: MergeShelfParams) {
  const apiVideoIds = new Set(apiContents.map(videoIdFromRichItem));
  const isShelfInResponse = apiContents.length > 0;
  function isUnlisted(item: RichGridItem) {
    const videoId = videoIdFromRichItem(item) ?? "";
    const isDropped = isShelfInResponse && isSemiSubscribedRichItem(item) && !apiVideoIds.has(videoId);
    return hiddenVideoIds.has(videoId) || isDropped;
  }

  const removedVideoIds = new Set(currentContents.filter(isUnlisted).flatMap(item => videoIdFromRichItem(item) ?? []));
  let contents = currentContents.filter(item => !removedVideoIds.has(videoIdFromRichItem(item) ?? ""));
  const insertedVideoIds = new Set<string>();
  for (const [iApiItem, apiItem] of apiContents.entries()) {
    const videoId = videoIdFromRichItem(apiItem);
    const isJoining =
      !!videoId &&
      isSemiSubscribedRichItem(apiItem) &&
      !hiddenVideoIds.has(videoId) &&
      !containsVideo({
        contents,
        videoId
      });
    if (!isJoining) {
      continue;
    }

    contents = contents.toSpliced(
      insertionIndex({
        contents,
        apiContents,
        iApiItem
      }),
      0,
      apiItem
    );
    insertedVideoIds.add(videoId);
  }
  return {
    contents,
    removedVideoIds,
    insertedVideoIds
  };
}

type WriteShelfParams = Prettify<{
  elShelf: PolymerElement;
  merge: ShelfMerge;
}>;

function writeShelf({ elShelf, merge }: WriteShelfParams) {
  if (!isAnimationsEnabled()) {
    elShelf.set("data.contents", merge.contents);
    alignOpenMenuToItsVideo();
    return;
  }

  animateShelfWrite({
    elShelf,
    ...merge
  }).catch(() => {});
}

type MirrorSemiSubscribedShelfVideosParams = Prettify<{
  apiContents: RichGridItem[];
  hiddenVideoIds: Set<string>;
}>;

export function mirrorSemiSubscribedShelfVideos({
  apiContents,
  hiddenVideoIds
}: MirrorSemiSubscribedShelfVideosParams) {
  const apiShelves = apiShelvesByTitle(apiContents);
  for (const [title, elShelves] of domShelvesByTitle()) {
    for (const [iShelf, elShelf] of elShelves.entries()) {
      const apiShelfContents = apiShelves.get(title)?.[iShelf];
      if (!isRichShelfData(elShelf.data)) {
        continue;
      }

      const merge = mergeSemiSubscribedVideos({
        currentContents: elShelf.data.contents ?? [],
        apiContents: apiShelfContents,
        hiddenVideoIds
      });
      const isChanged = merge.removedVideoIds.size > 0 || merge.insertedVideoIds.size > 0;
      if (isChanged) {
        writeShelf({
          elShelf,
          merge
        });
      }
    }
  }
}
