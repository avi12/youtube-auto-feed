import type { VideoSnapshot } from "../../types";
import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  extractAnimateIds,
  reassignTransitionNames,
  waitForFrames
} from "../animations";
import { deepArray, isPolymerElement, isRecord } from "../../helpers";
import { buildRichItem } from "../build";
import { findItemElement } from "../query";

export async function addSectionToDom(sectionTitle: string, videos: VideoSnapshot[]) {
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

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const elAllItems = elGridContents
    ? [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")]
    : [...document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];

  clearAllItemViewTransitionNames();
  assignItemViewTransitionNames(elAllItems);

  const animateIds = extractAnimateIds(elAllItems);

  const elShiftStyle = buildShiftTransitionStyle(elAllItems);
  document.head.append(elShiftStyle);

  const elNewItemTransitionStyles: HTMLStyleElement[] = [];

  const transition = document.startViewTransition(async () => {
    elGrid.set("data.contents", [newSection, ...deepArray(elGrid.data, "contents")]);
    for (const elItem of elAllItems) {
      elItem.style.viewTransitionName = "";
    }

    await waitForFrames(() => videos.every(video => findItemElement(video.videoId)));

    const elQueryItems = elGridContents
      ? elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")
      : document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
    reassignTransitionNames(elQueryItems, animateIds);

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
  });

  try {
    await transition.finished;
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
}
