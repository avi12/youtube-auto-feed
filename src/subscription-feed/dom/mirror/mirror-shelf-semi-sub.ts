import { isAnimationsEnabled } from "../../settings-state";
import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isRichShelfData } from "../../youtube-api/guards";
import { textFromInnerTubeText } from "../../youtube-api/renderer-fields";
import { isSemiSubscribedRichItem, videoIdFromRichItem } from "../rich-item";
import { usableShelves } from "./mirror-elements";
import { alignOpenMenuToItsVideo } from "./mirror-open-menu";
import { animateShelfWrite } from "./mirror-shelf-write";

// YouTube Semi-Subscribe lists videos from channels the viewer is not subscribed to, and owns whether
// they stay listed. The shelf mirror never adds to a shelf and never trusts absence, so its tagged videos
// are mirrored here: one joins a shelf when the response lists it there, right after its nearest listed
// neighbour, and leaves once that same shelf in the response stops listing it. Shelves pair up by title
// and occurrence, since YouTube may emit a title more than once.

type RichGridItem = Prettify<InnerTubeRichGridItem>;

type ShelfMerge = Prettify<{
  contents: RichGridItem[];
  removedVideoIds: Set<string>;
  insertedVideoIds: Set<string>;
}>;

function groupByTitle<TValue>(entries: {
  title: string;
  value: TValue;
}[]) {
  const groups = new Map<string, TValue[]>();
  for (const { title, value } of entries) {
    groups.set(title, [...groups.get(title) ?? [], value]);
  }
  return groups;
}

function apiShelvesByTitle(apiContents: RichGridItem[]) {
  return groupByTitle(
    apiContents.flatMap(item => {
      const richShelf = item.richSectionRenderer?.content?.richShelfRenderer;
      return richShelf
        ? [{
          title: textFromInnerTubeText(richShelf.title),
          value: richShelf.contents
        }]
        : [];
    })
  );
}

function domShelvesByTitle() {
  return groupByTitle(
    usableShelves().flatMap(elShelf => isRichShelfData(elShelf.data)
      ? [{
        title: textFromInnerTubeText(elShelf.data.title),
        value: elShelf
      }]
      : [])
  );
}

function containsVideo({ contents, videoId }: {
  contents: RichGridItem[];
  videoId: string;
}) {
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

type MergeShelfParams = Prettify<{
  currentContents: RichGridItem[];
  apiContents: RichGridItem[];
}>;

function mergeSemiSubscribedVideos({ currentContents, apiContents }: MergeShelfParams) {
  const apiVideoIds = new Set(apiContents.map(videoIdFromRichItem));
  const removedVideoIds = new Set(currentContents
    .filter(item => isSemiSubscribedRichItem(item) && !apiVideoIds.has(videoIdFromRichItem(item)))
    .flatMap(item => videoIdFromRichItem(item) ?? []));
  let contents = currentContents.filter(item => !removedVideoIds.has(videoIdFromRichItem(item) ?? ""));
  const insertedVideoIds = new Set<string>();
  for (const [iApiItem, apiItem] of apiContents.entries()) {
    const videoId = videoIdFromRichItem(apiItem);
    const isJoining = !!videoId && isSemiSubscribedRichItem(apiItem) && !containsVideo({
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
      }), 0, apiItem
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

export function mirrorSemiSubscribedShelfVideos(apiContents: RichGridItem[]) {
  const apiShelves = apiShelvesByTitle(apiContents);
  for (const [title, elShelves] of domShelvesByTitle()) {
    for (const [iShelf, elShelf] of elShelves.entries()) {
      const apiShelfContents = apiShelves.get(title)?.[iShelf];
      if (!apiShelfContents || !isRichShelfData(elShelf.data)) {
        continue;
      }

      const merge = mergeSemiSubscribedVideos({
        currentContents: elShelf.data.contents ?? [],
        apiContents: apiShelfContents
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
