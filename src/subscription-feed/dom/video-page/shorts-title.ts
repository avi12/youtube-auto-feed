import { z } from "../../../shared/zod";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { reelWatchEndpointSchema } from "../../youtube-api/schemas";
import { applyWithDissolve, setAttributeIfChanged, setNodeTextIfChanged } from "../update/dissolve";
import { updatePageTitle } from "./current-video";

// A Short's overlay title is a view model that does not re-render from new data, so its text node and
// accessible label are patched in place. The reel renderer is matched by the Short it is playing, since
// the shorts player keeps reels around for the ones before and after it.

const REEL_SELECTOR = "ytd-reel-video-renderer";
const SHORTS_TITLE_HEADING_SELECTOR = "yt-shorts-video-title-view-model h1";
const SHORTS_TITLE_TEXT_SELECTOR = "yt-shorts-video-title-view-model .ytAttributedStringHost";

const reelDataSchema = z.looseObject({
  command: z.looseObject({ reelWatchEndpoint: reelWatchEndpointSchema })
});

function findReel(videoId: string) {
  for (const elReel of document.querySelectorAll(REEL_SELECTOR)) {
    if (!isPolymerElement(elReel)) {
      continue;
    }

    const reelData = reelDataSchema.safeParse(elReel.data);
    if (reelData.success && reelData.data.command.reelWatchEndpoint.videoId === videoId) {
      return elReel;
    }
  }
  return null;
}

type ApplyShortsTitleParams = Prettify<{
  videoId: string;
  title: string;
}>;

export function applyShortsTitle({ videoId, title }: ApplyShortsTitleParams) {
  const elReel = findReel(videoId);
  const elText = elReel?.querySelector<HTMLElement>(SHORTS_TITLE_TEXT_SELECTOR) ?? null;
  const isTitleChanged = !!elText && title !== "" && elText.textContent !== title;
  if (!isTitleChanged) {
    return;
  }

  applyWithDissolve({
    elements: [elText],
    apply() {
      setNodeTextIfChanged({
        elNode: elText,
        newText: title
      });
      setAttributeIfChanged({
        elNode: elReel?.querySelector(SHORTS_TITLE_HEADING_SELECTOR) ?? null,
        name: "aria-label",
        value: title
      });
    }
  });
  updatePageTitle(title);
}
