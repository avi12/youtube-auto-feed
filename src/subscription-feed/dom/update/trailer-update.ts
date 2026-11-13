import type { Prettify } from "@/subscription-feed/types/prettify";
import type { VideoSnapshot } from "@/subscription-feed/types/video";

import { applyWithDissolve, setNodeTextIfChanged } from "./dissolve";

// The channel-page trailer (ytd-channel-video-player-renderer) renders its own title and a
// ytd-video-meta-block of view-count + published-time spans. Polymer dirty-checks the bound data
// object by reference, so set(path, value) does not repaint it; the text is patched in place instead.

const TRAILER_TITLE_SELECTOR = "#title";
const TRAILER_META_ITEM_SELECTOR = "ytd-video-meta-block span.inline-metadata-item";

type ApplyTrailerUpdateParams = Prettify<{
  elTrailer: HTMLElement;
  fresh: Prettify<VideoSnapshot>;
}>;

export function applyTrailerUpdate({ elTrailer, fresh }: ApplyTrailerUpdateParams) {
  const elTitle = elTrailer.querySelector<HTMLElement>(TRAILER_TITLE_SELECTOR);
  const metaItems = elTrailer.querySelectorAll<HTMLElement>(TRAILER_META_ITEM_SELECTOR);
  const [elViews, elPublished] = metaItems;

  const changed: HTMLElement[] = [];
  function noteChange({ elNode, text }: { elNode: HTMLElement | null | undefined; text: string }) {
    if (elNode && text !== "" && elNode.textContent !== text) {
      changed.push(elNode);
    }
  }
  noteChange({ elNode: elTitle, text: fresh.title });
  noteChange({ elNode: elViews, text: fresh.viewCountText });
  noteChange({ elNode: elPublished, text: fresh.publishedTimeText });

  if (changed.length === 0) {
    return;
  }

  applyWithDissolve({
    elements: changed,
    apply() {
      setNodeTextIfChanged({
        elNode: elTitle,
        newText: fresh.title
      });
      setNodeTextIfChanged({
        elNode: elViews ?? null,
        newText: fresh.viewCountText
      });
      setNodeTextIfChanged({
        elNode: elPublished ?? null,
        newText: fresh.publishedTimeText
      });
    }
  });
}
