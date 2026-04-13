import {
  assignItemViewTransitionNames,
  buildStaggerStyle,
  clearItemViewTransitionNames
} from "../animations";
import { deepArray, isPolymerElement, isRecord } from "../helpers";
import type { VideoSnapshot } from "../types";
import { buildRichItem } from "./renderer";

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

  assignItemViewTransitionNames(elAllItems);
  const elStaggerStyle = buildStaggerStyle(elAllItems);
  document.head.append(elStaggerStyle);

  try {
    await document.startViewTransition(() => {
      elGrid.set("data.contents", [newSection, ...deepArray(elGrid.data, "contents")]);
      assignItemViewTransitionNames(elAllItems);
    }).finished;
  } finally {
    elStaggerStyle.remove();
    clearItemViewTransitionNames(elAllItems);
  }
}
