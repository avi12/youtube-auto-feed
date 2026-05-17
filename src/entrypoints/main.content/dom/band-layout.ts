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

  return {
    sectionOrder,
    bandCaps
  };
}

export function consolidateStandaloneItems() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = [...deepArray(elGrid.data, "contents")];

  let firstSectionIndex = -1;
  let latestBlockEndIndex = contents.length;
  for (let i = 0; i < contents.length; i++) {
    const isSection = !!readSectionTitle(contents[i]);
    if (!isSection) {
      continue;
    }

    if (firstSectionIndex < 0) {
      firstSectionIndex = i;
      continue;
    }

    latestBlockEndIndex = i;
    break;
  }

  if (firstSectionIndex < 0 || latestBlockEndIndex === contents.length) {
    return;
  }

  const orphanedItems: unknown[] = [];
  const orphanedIndices = new Set<number>();
  for (let i = latestBlockEndIndex; i < contents.length; i++) {
    if (videoIdFromRichItem(contents[i])) {
      orphanedItems.push(contents[i]);
      orphanedIndices.add(i);
    }
  }

  if (orphanedItems.length === 0) {
    return;
  }

  const newContents = contents.filter((_, i) => !orphanedIndices.has(i));
  newContents.splice(latestBlockEndIndex, 0, ...orphanedItems);
  elGrid.set("data.contents", newContents);
}

export function dismantleAbsentSections(polledSectionOrder: string[], confirmedAbsentSections: Set<string>): string[] {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data) || polledSectionOrder.length === 0) {
    return [];
  }

  const polledSet = new Set(polledSectionOrder);
  const contents = deepArray(elGrid.data, "contents");
  const newContents: unknown[] = [];
  const candidateAbsent: string[] = [];
  let hasChange = false;

  for (const item of contents) {
    const sectionTitle = readSectionTitle(item);
    if (sectionTitle && !polledSet.has(sectionTitle)) {
      candidateAbsent.push(sectionTitle);
      if (confirmedAbsentSections.has(sectionTitle)) {
        const richShelfContents = deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents");
        newContents.push(...richShelfContents);
        hasChange = true;
        continue;
      }
    }

    newContents.push(item);
  }

  if (hasChange) {
    elGrid.set("data.contents", newContents);
  }

  return candidateAbsent;
}

export function reorderSections(polledSectionOrder: string[]) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = [...deepArray(elGrid.data, "contents")];
  const continuationIndex = contents.findIndex(item => isRecord(item) && "continuationItemRenderer" in item);
  const beforeContinuation = continuationIndex >= 0 ? contents.slice(0, continuationIndex) : contents;
  const trailing = continuationIndex >= 0 ? contents.slice(continuationIndex) : [];

  interface Block { sectionTitle: string | null; items: unknown[] }
  const blocks: Block[] = [];
  let currentBlock: Block = { sectionTitle: null, items: [] };
  for (const item of beforeContinuation) {
    const sectionTitle = readSectionTitle(item);
    if (sectionTitle) {
      if (currentBlock.items.length > 0 || currentBlock.sectionTitle !== null) {
        blocks.push(currentBlock);
      }

      currentBlock = { sectionTitle, items: [item] };
      continue;
    }

    currentBlock.items.push(item);
  }
  if (currentBlock.items.length > 0 || currentBlock.sectionTitle !== null) {
    blocks.push(currentBlock);
  }

  const preambleItems = blocks.length > 0 && blocks[0].sectionTitle === null ? blocks[0].items : [];
  const sectionBlocks = new Map<string, Block>();
  for (const block of blocks) {
    if (block.sectionTitle !== null) {
      sectionBlocks.set(block.sectionTitle, block);
    }
  }

  const currentSectionOrder = blocks.filter(block => block.sectionTitle !== null).map(block => block.sectionTitle as string);
  const targetOrder = polledSectionOrder.filter(section => sectionBlocks.has(section));
  if (JSON.stringify(currentSectionOrder) === JSON.stringify(targetOrder)) {
    return;
  }

  const newContents: unknown[] = [...preambleItems];
  for (const section of polledSectionOrder) {
    const block = sectionBlocks.get(section);
    if (block) {
      newContents.push(...block.items);
      sectionBlocks.delete(section);
    }
  }

  for (const block of sectionBlocks.values()) {
    newContents.push(...block.items);
  }
  newContents.push(...trailing);

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
