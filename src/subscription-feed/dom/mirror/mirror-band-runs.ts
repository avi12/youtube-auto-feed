import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { videoIdFromRichItem } from "../rich-item";
import type { InlineBandEntry } from "./mirror-band-merge";

export function extractInlineBand(contents: Prettify<InnerTubeRichGridItem>[]) {
  const band: InlineBandEntry[] = [];
  for (const run of findAllInlineRuns(contents)) {
    for (let i = run.start; i < run.end; i++) {
      const item = contents[i];
      const videoId = videoIdFromRichItem(item);
      if (!videoId) {
        continue;
      }

      band.push({
        videoId,
        item
      });
    }
  }
  return band;
}

export function findAllInlineRuns(contents: Prettify<InnerTubeRichGridItem>[]) {
  const runs: {
    start: number;
    end: number;
  }[] = [];
  let runStart = -1;
  for (let i = 0; i < contents.length; i++) {
    const isInlinePresent = !!videoIdFromRichItem(contents[i]);
    if (isInlinePresent && runStart === -1) {
      runStart = i;
    }

    if (!isInlinePresent && runStart !== -1) {
      runs.push({
        start: runStart,
        end: i
      });
      runStart = -1;
    }
  }

  if (runStart !== -1) {
    runs.push({
      start: runStart,
      end: contents.length
    });
  }

  return runs;
}

export function collectInlineVideoIds(contents: Prettify<InnerTubeRichGridItem>[]) {
  const ids = new Set<string>();
  for (const item of contents) {
    const videoId = videoIdFromRichItem(item);
    if (videoId) {
      ids.add(videoId);
    }
  }
  return ids;
}

type IsReferenceEqualArrayParams = Prettify<{
  left: readonly unknown[];
  right: readonly unknown[];
}>;

export function isReferenceEqualArray({ left, right }: IsReferenceEqualArrayParams) {
  return left.length === right.length && left.every((item, i) => item === right[i]);
}
