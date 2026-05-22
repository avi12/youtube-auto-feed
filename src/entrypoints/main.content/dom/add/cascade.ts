import {
  deepArray,
  deepRecord,
  deepString,
  isPolymerElement,
  isRecord
} from "../../helpers";
import { type VideoSnapshot } from "../../types";
import { type BandLayout, type CapturedBand } from "../band-layout";
import { buildRichItem, preloadThumbnails } from "../build";
import { videoIdFromRichItem } from "../rich-item";

function findAllInlineRuns(contents: unknown[]) {
  const runs: Array<{
    start: number;
    end: number;
  }> = [];
  let runStart = -1;

  for (let i = 0; i < contents.length; i++) {
    if (videoIdFromRichItem(contents[i])) {
      if (runStart < 0) {
        runStart = i;
      }

      continue;
    }

    if (runStart >= 0) {
      runs.push({
        start: runStart,
        end: i
      });
      runStart = -1;
    }
  }

  if (runStart >= 0) {
    runs.push({
      start: runStart,
      end: contents.length
    });
  }

  return runs;
}

function applyInlineCascade(
  contents: unknown[],
  newItems: unknown[],
  inlineBands: CapturedBand[]
) {
  const runs = findAllInlineRuns(contents);
  let itemsToPlace = [...newItems];

  for (let iLevel = 0; iLevel < inlineBands.length && itemsToPlace.length > 0; iLevel++) {
    const band = inlineBands[iLevel];
    const run = runs[iLevel];
    if (!run) {
      break;
    }

    const currentItems = contents.slice(run.start, run.end);
    const mergedItems = [...itemsToPlace, ...currentItems];
    const isLastBand = iLevel === inlineBands.length - 1;
    const shouldCascade = !band.isUnbounded && !isLastBand && mergedItems.length > band.initialCount;
    const keepItems = shouldCascade ? mergedItems.slice(0, band.initialCount) : mergedItems;
    itemsToPlace = shouldCascade ? mergedItems.slice(band.initialCount) : [];

    contents.splice(run.start, currentItems.length, ...keepItems);
    const shift = keepItems.length - currentItems.length;
    for (let iRun = iLevel + 1; iRun < runs.length; iRun++) {
      runs[iRun].start += shift;
      runs[iRun].end += shift;
    }
  }
}

function applyRichShelfCascade(
  contents: unknown[],
  newItems: unknown[],
  shelfBands: CapturedBand[]
) {
  let itemsToPlace = [...newItems];

  for (let iLevel = 0; iLevel < shelfBands.length && itemsToPlace.length > 0; iLevel++) {
    const band = shelfBands[iLevel];
    const iSection = contents.findIndex(item =>
      deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text") === band.sectionTitle);
    if (iSection < 0) {
      break;
    }

    const richSection = deepRecord(contents[iSection], "richSectionRenderer");
    const richContent = deepRecord(richSection, "content");
    const richShelf = deepRecord(richContent, "richShelfRenderer");
    if (!richSection || !richContent || !richShelf) {
      break;
    }

    const shelfContents = deepArray(richShelf, "contents");
    const mergedContents = [...itemsToPlace, ...shelfContents];
    const isLastBand = iLevel === shelfBands.length - 1;
    const shouldCascade = !band.isUnbounded && !isLastBand && mergedContents.length > band.initialCount;
    const keepContents = shouldCascade ? mergedContents.slice(0, band.initialCount) : mergedContents;
    itemsToPlace = shouldCascade ? mergedContents.slice(band.initialCount) : [];

    contents[iSection] = {
      richSectionRenderer: {
        ...richSection,
        content: {
          ...richContent,
          richShelfRenderer: {
            ...richShelf,
            contents: keepContents
          }
        }
      }
    };
  }
}

export async function cascadeInsertVideos({
  videosToAdd,
  bandLayout
}: {
  videosToAdd: VideoSnapshot[];
  bandLayout: BandLayout;
}) {
  if (videosToAdd.length === 0) {
    return;
  }

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  await preloadThumbnails(videosToAdd);
  const contents = [...deepArray(elGrid.data, "contents")];

  const inlineVideos = videosToAdd.filter(video => !video.sectionTitle);
  if (inlineVideos.length > 0) {
    const inlineBands = bandLayout.bands.filter(band => band.kind === "inline");
    if (inlineBands.length > 0) {
      applyInlineCascade(contents, inlineVideos.map(video => buildRichItem(video.rawRenderer)), inlineBands);
    }
  }

  const shelfSectionTitles = new Set(
    videosToAdd.filter(video => !!video.sectionTitle).map(video => video.sectionTitle)
  );
  for (const sectionTitle of shelfSectionTitles) {
    const shelfBands = bandLayout.bands.filter(band => band.kind === "richShelf" && band.sectionTitle === sectionTitle);
    if (shelfBands.length === 0) {
      continue;
    }

    const sectionVideos = videosToAdd.filter(video => video.sectionTitle === sectionTitle);
    applyRichShelfCascade(contents, sectionVideos.map(video => buildRichItem(video.rawRenderer)), shelfBands);
  }

  elGrid.set("data.contents", contents);
}
