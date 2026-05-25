import { deepArray, isPolymerElement, isRecord } from "../../helpers";
import type { InnerTubeRichGridItem, VideoSnapshot } from "../../types";
import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  extractAnimateIds,
  reassignTransitionNames,
  waitForFrames,
  withViewTransitionLock
} from "../animations";
import { buildRichItem } from "../build";
import { findItemElement } from "../query";
import { findSectionInsertIndex } from "./grid";

export async function addSectionToDom({ sectionTitle, videos, allFreshSnapshots }: {
  sectionTitle: string;
  videos: VideoSnapshot[];
  allFreshSnapshots: VideoSnapshot[];
}) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const newSection = {
    richSectionRenderer: {
      content: {
        richShelfRenderer: {
          title: { runs: [{ text: sectionTitle }] },
          contents: videos.map(({ rawRenderer }) => buildRichItem(rawRenderer)),
          trackingParams: ""
        }
      },
      trackingParams: ""
    }
  };

  const freshOrderMap = new Map(allFreshSnapshots.map((video, i) => [video.videoId, i]));
  const sectionMinimumFreshIndex = videos.reduce(
    (minimum, video) => Math.min(minimum, freshOrderMap.get(video.videoId) ?? Infinity),
    Infinity
  );

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const elAllItems = elGridContents
    ? [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")]
    : [...document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];

  clearAllItemViewTransitionNames();
  assignItemViewTransitionNames(elAllItems);

  const animateIds = extractAnimateIds(elAllItems);

  const elShiftStyle = buildShiftTransitionStyle({ elItems: elAllItems });
  document.head.append(elShiftStyle);

  const elNewItemTransitionStyles: HTMLStyleElement[] = [];

  await withViewTransitionLock(async () => {
    try {
      await document.startViewTransition(async () => {
        const contents = [...deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")];
        const iInsert = findSectionInsertIndex({
          contents,
          sectionMinimumFreshIndex,
          freshOrderMap
        });
        contents.splice(iInsert, 0, newSection);
        elGrid.set("data.contents", contents);
        for (const elItem of elAllItems) {
          elItem.style.viewTransitionName = "";
        }

        await waitForFrames({ predicate: () => videos.every(video => findItemElement(video.videoId)) });

        const elQueryItems = elGridContents
          ? elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")
          : document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
        reassignTransitionNames({
          elItems: elQueryItems,
          animateIds
        });

        const elNewItems: HTMLElement[] = [];
        for (const video of videos) {
          const elNewItem = findItemElement(video.videoId);
          if (elNewItem) {
            elNewItem.style.viewTransitionName = `ytsua-item-${video.videoId}`;
            elNewItems.push(elNewItem);
          }
        }

        if (elNewItems.length > 0) {
          const elNewItemTransitionStyle = buildNewItemTransitionStyle(elNewItems);
          document.head.append(elNewItemTransitionStyle);
          elNewItemTransitionStyles.push(elNewItemTransitionStyle);
        }
      }).finished;
    } finally {
      clearAllItemViewTransitionNames();
      elShiftStyle.remove();
      elNewItemTransitionStyles[0]?.remove();
      for (const video of videos) {
        const elNewItem = findItemElement(video.videoId);
        if (elNewItem) {
          elNewItem.style.viewTransitionName = "";
        }
      }
    }
  });
}
