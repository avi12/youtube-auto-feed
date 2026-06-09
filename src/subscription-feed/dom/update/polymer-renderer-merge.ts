import type {
  InnerTubeRichItemContent,
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isLockupViewModel, isShortsLockupViewModel } from "../../youtube-api/guards";
import { richItemContentSchema } from "../../youtube-api/schemas";
import { mergeLockupViewModel } from "./lockup-model";
import { buildMergedVideoRenderer } from "./merged-video-renderer";

type ApplyRichItemContentUpdateParams = Prettify<{
  elElement: PolymerElement;
  basePath: string;
  existingContent: Prettify<InnerTubeRichItemContent> | Record<string, unknown>;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage: boolean;
}>;

export function applyRichItemContentUpdate({
  elElement,
  basePath,
  existingContent,
  rawRenderer,
  forcePreserveContentImage
}: ApplyRichItemContentUpdateParams) {
  const parsedExisting = richItemContentSchema.safeParse(existingContent);
  const existing = parsedExisting.success ? parsedExisting.data : null;
  if (existing?.richGridMediaRenderer) {
    elElement.set(`${basePath}.richGridMediaRenderer.content.videoRenderer`, rawRenderer);
    return;
  }

  const existingLockup = existing?.lockupViewModel;
  if (isLockupViewModel(rawRenderer) || existingLockup !== undefined) {
    const merged = isLockupViewModel(rawRenderer) && isLockupViewModel(existingLockup)
      ? mergeLockupViewModel({
        existing: existingLockup,
        incoming: rawRenderer,
        forcePreserveContentImage
      })
      : rawRenderer;
    elElement.set(`${basePath}.lockupViewModel`, merged);
    return;
  }

  if (isShortsLockupViewModel(rawRenderer) || existing?.shortsLockupViewModel !== undefined) {
    elElement.set(`${basePath}.shortsLockupViewModel`, rawRenderer);
    return;
  }

  const existingGridVideoRenderer = existing?.gridVideoRenderer;
  if (existingGridVideoRenderer) {
    elElement.set(
      `${basePath}.gridVideoRenderer`, buildMergedVideoRenderer({
        existing: existingGridVideoRenderer,
        incoming: rawRenderer,
        forcePreserveContentImage
      })
    );
    return;
  }

  elElement.set(
    `${basePath}.videoRenderer`, buildMergedVideoRenderer({
      existing: existing?.videoRenderer ?? null,
      incoming: rawRenderer,
      forcePreserveContentImage
    })
  );
}
