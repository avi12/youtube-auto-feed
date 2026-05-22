import { deepArray, deepString, isPolymerElement, isRecord } from "../helpers";
import { videoIdFromRichItem } from "./rich-item";

const BAND_NORMALIZATION_MIN_INLINE_COUNT = 9;
const BAND_NORMALIZATION_MAX_POST_SECTION_COUNT = 3;

export interface BandLayout {
  sectionOrder: string[];
  bandCaps: Map<string, number>;
}

function readSectionTitle(item: unknown) {
  return deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text")
    || deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text");
}

export function captureBandLayout() {
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

export function dismantleAbsentSections({
  polledSectionOrder,
  confirmedAbsentSections,
  protectedSections = new Set<string>()
}: {
  polledSectionOrder: string[];
  confirmedAbsentSections: Set<string>;
  protectedSections?: Set<string>;
}) {
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
    if (sectionTitle && !polledSet.has(sectionTitle) && !protectedSections.has(sectionTitle)) {
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

  interface Block { sectionTitle: string | null;
    items: unknown[]; }
  const blocks: Block[] = [];
  let currentBlock: Block = {
    sectionTitle: null,
    items: []
  };
  for (const item of beforeContinuation) {
    const sectionTitle = readSectionTitle(item);
    if (sectionTitle) {
      if (currentBlock.items.length > 0 || currentBlock.sectionTitle !== null) {
        blocks.push(currentBlock);
      }

      currentBlock = {
        sectionTitle,
        items: [item]
      };
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

export function moveSectionsToTail(tailSectionTitles: Set<string>) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = [...deepArray(elGrid.data, "contents")];
  const continuationIndex = contents.findIndex(item => isRecord(item) && "continuationItemRenderer" in item);
  const tailInsertIndex = continuationIndex >= 0 ? continuationIndex : contents.length;

  const tailSectionIndices: number[] = [];
  for (let i = 0; i < tailInsertIndex; i++) {
    const title = readSectionTitle(contents[i]);
    if (title && tailSectionTitles.has(title)) {
      tailSectionIndices.push(i);
    }
  }

  if (tailSectionIndices.length === 0) {
    return;
  }

  const lastTailIndex = tailSectionIndices[tailSectionIndices.length - 1];
  const tailStartIndex = tailInsertIndex - tailSectionIndices.length;
  const isAlreadyAtTail = lastTailIndex === tailInsertIndex - 1 &&
    tailSectionIndices.every((sectionIndex, iSection) => sectionIndex === tailStartIndex + iSection);
  if (isAlreadyAtTail) {
    return;
  }

  const tailSections = tailSectionIndices.map(sectionIndex => contents[sectionIndex]);
  const tailSectionIndexSet = new Set(tailSectionIndices);
  const remainingContents = contents.filter((_, contentIndex) => !tailSectionIndexSet.has(contentIndex));
  const newContinuationIndex = remainingContents.findIndex(item => isRecord(item) && "continuationItemRenderer" in item);
  const insertAt = newContinuationIndex >= 0 ? newContinuationIndex : remainingContents.length;
  remainingContents.splice(insertAt, 0, ...tailSections);

  elGrid.set("data.contents", remainingContents);
}

export function normalizeInitialBandLayout() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = [...deepArray(elGrid.data, "contents")];
  const continuationIndex = contents.findIndex(item => isRecord(item) && "continuationItemRenderer" in item);
  const end = continuationIndex >= 0 ? continuationIndex : contents.length;

  let firstContentSectionIndex = -1;
  let band0InlineCount = 0;
  let postSectionInlineCount = 0;

  for (let i = 0; i < end; i++) {
    if (readSectionTitle(contents[i])) {
      if (firstContentSectionIndex < 0) {
        firstContentSectionIndex = i;
      }

      continue;
    }

    if (videoIdFromRichItem(contents[i])) {
      if (firstContentSectionIndex < 0) {
        band0InlineCount++;
      } else {
        postSectionInlineCount++;
      }
    }
  }

  if (
    firstContentSectionIndex < 0
    || band0InlineCount <= BAND_NORMALIZATION_MIN_INLINE_COUNT
    || postSectionInlineCount > BAND_NORMALIZATION_MAX_POST_SECTION_COUNT
  ) {
    return;
  }

  const band0Items: unknown[] = [];
  const newContents: unknown[] = [];
  for (let i = 0; i < contents.length; i++) {
    if (i < firstContentSectionIndex && videoIdFromRichItem(contents[i])) {
      band0Items.push(contents[i]);
    } else {
      newContents.push(contents[i]);
    }
  }

  const newContinuationIndex = newContents.findIndex(item => isRecord(item) && "continuationItemRenderer" in item);
  const insertAt = newContinuationIndex >= 0 ? newContinuationIndex : newContents.length;
  newContents.splice(insertAt, 0, ...band0Items);
  elGrid.set("data.contents", newContents);
}

// Collapsed shelves (isExpanded: false) sometimes render more than one visible row
// depending on the browser's grid column count. This trims the overflow visible
// items from the data model so YouTube always shows exactly one row.
// Only overflow items are removed - hidden data items (not rendered in DOM) are preserved.
export async function normalizeCollapsedShelfRows() {
  const trimmedVideoIds = new Set<string>();
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf) || !isRecord(elShelf.data) || elShelf.data.isExpanded !== false) {
      continue;
    }

    // Two frames let Polymer finish rendering the shelf before we measure layout.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const elItems = [...elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];
    // offsetWidth === 0 means YouTube has hidden the item (not part of the visible row set).
    const visibleItems = elItems.filter(elItem => elItem.offsetWidth > 0);
    if (visibleItems.length === 0) {
      continue;
    }

    const firstRowTop = Math.round(visibleItems[0].getBoundingClientRect().top);
    const overflowItems = visibleItems.filter(
      elItem => Math.round(elItem.getBoundingClientRect().top) !== firstRowTop
    );
    if (overflowItems.length === 0) {
      continue;
    }

    const overflowVideoIds = new Set(
      overflowItems.flatMap(elItem => {
        if (!isPolymerElement(elItem)) {
          return [];
        }

        const videoId = videoIdFromRichItem(elItem.data);
        return videoId ? [videoId] : [];
      })
    );

    // Filter data by video ID (not index) so hidden items beyond the visible set are untouched.
    const currentContents = deepArray(elShelf.data, "contents");
    const normalizedContents = currentContents.filter(item => {
      const videoId = videoIdFromRichItem(item);
      if (videoId && overflowVideoIds.has(videoId)) {
        trimmedVideoIds.add(videoId);
        return false;
      }

      return true;
    });

    elShelf.set("data.contents", normalizedContents);
  }
  return trimmedVideoIds;
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
