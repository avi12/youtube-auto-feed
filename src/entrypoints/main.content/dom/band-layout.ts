import { deepArray, deepString, isPolymerElement, isRecord } from "../helpers";
import { videoIdFromRichItem } from "./rich-item";

export interface BandLayout {
  sectionOrder: string[];
  bandCaps: Map<string, number>;
}

function readSectionTitle(item: unknown) {
  return deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text")
    || deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text");
}

export function captureBandLayout(): BandLayout | null {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return null;
  }

  const contents = deepArray(elGrid.data, "contents");

  const sectionOrder: string[] = [];
  const bandCaps = new Map<string, number>();
  let currentBand = "";
  let itemCount = 0;

  for (const item of contents) {
    const sectionTitle = readSectionTitle(item);
    if (sectionTitle) {
      if (itemCount > 0) {
        bandCaps.set(currentBand, itemCount);
      }
      sectionOrder.push(sectionTitle);
      currentBand = sectionTitle;
      itemCount = 0;
      continue;
    }
    if (!videoIdFromRichItem(item)) {
      continue;
    }
    itemCount++;
  }
  if (itemCount > 0) {
    bandCaps.set(currentBand, itemCount);
  }
  return { sectionOrder, bandCaps };
}

export function consolidateStandaloneItems() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = [...deepArray(elGrid.data, "contents")];

  let sectionsEncountered = 0;
  let latestBandEndIndex = -1;
  for (let i = 0; i < contents.length; i++) {
    if (readSectionTitle(contents[i])) {
      sectionsEncountered++;
      if (sectionsEncountered === 2) {
        latestBandEndIndex = i;
        break;
      }
    }
  }

  if (latestBandEndIndex < 0) {
    return;
  }

  const trailingItems: unknown[] = [];
  const trailingIndices = new Set<number>();
  for (let i = latestBandEndIndex; i < contents.length; i++) {
    if (videoIdFromRichItem(contents[i])) {
      trailingItems.push(contents[i]);
      trailingIndices.add(i);
    }
  }

  if (trailingItems.length === 0) {
    return;
  }

  const newContents = contents.filter((_, i) => !trailingIndices.has(i));
  newContents.splice(latestBandEndIndex, 0, ...trailingItems);
  elGrid.set("data.contents", newContents);
}

export function enforceBandLayout(layout: BandLayout) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = [...deepArray(elGrid.data, "contents")];
  const preLength = contents.length;
  let currentBand = "";
  const seen = new Map<string, number>();
  const indicesToRemove: number[] = [];
  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];
    const sectionTitle = readSectionTitle(item);
    if (sectionTitle) {
      currentBand = sectionTitle;
      continue;
    }
    if (!videoIdFromRichItem(item)) {
      continue;
    }
    const count = (seen.get(currentBand) ?? 0) + 1;
    seen.set(currentBand, count);
    const cap = layout.bandCaps.get(currentBand);
    if (cap !== undefined && count > cap) {
      indicesToRemove.push(i);
    }
  }
  for (let i = indicesToRemove.length - 1; i >= 0; i--) {
    contents.splice(indicesToRemove[i], 1);
  }
  if (contents.length < preLength) {
    elGrid.set("data.contents", contents);
  }
}
