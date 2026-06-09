import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { isPolymerElement } from "../utils/polymer";
import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../youtube-api/guards";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "../youtube-api/parse-video";
import { richItemDataSchema } from "../youtube-api/schemas";

interface SectionContext {
  sectionTitle: string;
  bandIndex: number;
}

type ParseRichItemRendererParams = Prettify<SectionContext & {
  rawRenderer: Record<string, unknown> | null;
}>;

function parseRichItemRenderer({ rawRenderer, sectionTitle, bandIndex }: ParseRichItemRendererParams) {
  if (isVideoRenderer(rawRenderer)) {
    return parseRenderer({
      renderer: rawRenderer,
      sectionTitle,
      bandIndex
    });
  }

  if (isLockupViewModel(rawRenderer)) {
    return parseLockupViewModel({
      lockup: rawRenderer,
      sectionTitle,
      bandIndex
    });
  }

  if (isShortsLockupViewModel(rawRenderer)) {
    return parseShortsLockupViewModel({
      shortsLockup: rawRenderer,
      sectionTitle,
      bandIndex
    });
  }

  return null;
}

type AddRichItemToSnapshotParams = Prettify<SectionContext & {
  elItem: Element;
  snapshot: Map<string, Prettify<VideoSnapshot>>;
}>;

export function addRichItemToSnapshot({ elItem, sectionTitle, bandIndex, snapshot }: AddRichItemToSnapshotParams) {
  if (!isPolymerElement(elItem)) {
    return;
  }

  const parsed = richItemDataSchema.safeParse(elItem.data);
  const content = parsed.success ? parsed.data.content : undefined;
  if (!content) {
    return;
  }

  const rawRenderer = content.videoRenderer
    ?? content.gridVideoRenderer
    ?? content.richGridMediaRenderer?.content?.videoRenderer
    ?? content.lockupViewModel
    ?? content.shortsLockupViewModel
    ?? null;
  const videoSnapshot = parseRichItemRenderer({
    rawRenderer,
    sectionTitle,
    bandIndex
  });
  if (!videoSnapshot || snapshot.has(videoSnapshot.videoId)) {
    return;
  }

  snapshot.set(videoSnapshot.videoId, videoSnapshot);
}
