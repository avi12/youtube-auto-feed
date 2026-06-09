import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { applyToGridModel, applyToLegacyShelfModels, applyToRichShelfModels } from "./polymer-sync-appliers";

// Update every model position (grid root, rich shelves, legacy shelves) so all DOM copies refresh.
type SyncGridModelItemParams = Prettify<{
  videoId: string;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage?: boolean;
}>;

export function syncGridModelItem({
  videoId,
  rawRenderer,
  forcePreserveContentImage = false
}: SyncGridModelItemParams) {
  applyToGridModel({
    videoId,
    rawRenderer,
    forcePreserveContentImage
  });
  applyToRichShelfModels({
    videoId,
    rawRenderer,
    forcePreserveContentImage
  });
  applyToLegacyShelfModels({
    videoId,
    rawRenderer,
    forcePreserveContentImage
  });
}
