import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  extractAnimateIds,
  reassignTransitionNames,
} from "../animations";
import { deepArray, isPolymerElement, isRecord } from "../helpers";
import type { VideoSnapshot } from "../types";
import { buildRichItem } from "./build";
import { findItemElement } from "./query";

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

  let elNewItemTransitionStyle: HTMLStyleElement | null = null;

  const transition = document.startViewTransition(async () => {
    elGrid.set("data.contents", [newSection, ...deepArray(elGrid.data, "contents")]);
    for (const elItem of elAllItems) {
      elItem.style.viewTransitionName = "";
    }

    for (let i = 0; i < 10 && videos.some(video => !findItemElement(video.videoId)); i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }

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
      elNewItemTransitionStyle = buildNewItemTransitionStyle(elNewItems);
      document.head.append(elNewItemTransitionStyle);
    }
  });

  try {
    await transition.finished;
  } finally {
    clearAllItemViewTransitionNames();
    elShiftStyle.remove();
    elNewItemTransitionStyle?.remove();
    for (const video of videos) {
      const elNewItem = findItemElement(video.videoId);
      if (elNewItem) elNewItem.style.viewTransitionName = "";
    }
  }
}
