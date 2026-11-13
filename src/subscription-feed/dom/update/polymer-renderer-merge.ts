import type {
  InnerTubeRichItemContent,
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "@/subscription-feed/types/innertube";
import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { isLockupViewModel, isShortsLockupViewModel } from "@/subscription-feed/youtube-api/guards";
import { richItemContentSchema } from "@/subscription-feed/youtube-api/schemas";

import { mergeLockupViewModel } from "./lockup-model";
import { buildMergedVideoRenderer } from "./merged-video-renderer";

type ApplyRichItemContentUpdateParams = Prettify<{
  elElement: PolymerElement;
  basePath: string;
  existingContent: Prettify<InnerTubeRichItemContent> | Record<string, unknown>;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  isContentImagePreserveForced: boolean;
}>;

export function applyRichItemContentUpdate({
  elElement,
  basePath,
  existingContent,
  rawRenderer,
  isContentImagePreserveForced
}: ApplyRichItemContentUpdateParams) {
  const parsedExisting = richItemContentSchema.safeParse(existingContent);
  const existing = parsedExisting.success ? parsedExisting.data : null;
  if (existing?.richGridMediaRenderer) {
    elElement.set(`${basePath}.richGridMediaRenderer.content.videoRenderer`, rawRenderer);
    return;
  }

  const existingLockup = existing?.lockupViewModel;
  const hasLockupSource = isLockupViewModel(rawRenderer) || existingLockup !== undefined;
  if (hasLockupSource) {
    const isMergeable = isLockupViewModel(rawRenderer) && isLockupViewModel(existingLockup);
    const merged = isMergeable
      ? mergeLockupViewModel({
          existing: existingLockup,
          incoming: rawRenderer,
          isContentImagePreserveForced
        })
      : rawRenderer;
    elElement.set(`${basePath}.lockupViewModel`, merged);
    return;
  }

  const hasShortsSource = isShortsLockupViewModel(rawRenderer) || existing?.shortsLockupViewModel !== undefined;
  if (hasShortsSource) {
    elElement.set(`${basePath}.shortsLockupViewModel`, rawRenderer);
    return;
  }

  const existingGridVideoRenderer = existing?.gridVideoRenderer;
  if (existingGridVideoRenderer) {
    elElement.set(
      `${basePath}.gridVideoRenderer`,
      buildMergedVideoRenderer({
        existing: existingGridVideoRenderer,
        incoming: rawRenderer,
        isContentImagePreserveForced
      })
    );
    return;
  }

  elElement.set(
    `${basePath}.videoRenderer`,
    buildMergedVideoRenderer({
      existing: existing?.videoRenderer ?? null,
      incoming: rawRenderer,
      isContentImagePreserveForced
    })
  );
}
