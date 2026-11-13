import type {
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "@/subscription-feed/types/innertube";
import type { Prettify } from "@/subscription-feed/types/prettify";

import { applyToGridModel, applyToLegacyShelfModels, applyToRichShelfModels } from "./polymer-sync-appliers";

// Update every model position (grid root, rich shelves, legacy shelves) so all DOM copies refresh.
type SyncGridModelItemParams = Prettify<{
  videoId: string;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  isContentImagePreserveForced?: boolean;
}>;

export function syncGridModelItem({
  videoId,
  rawRenderer,
  isContentImagePreserveForced = false
}: SyncGridModelItemParams) {
  applyToGridModel({
    videoId,
    rawRenderer,
    isContentImagePreserveForced
  });
  applyToRichShelfModels({
    videoId,
    rawRenderer,
    isContentImagePreserveForced
  });
  applyToLegacyShelfModels({
    videoId,
    rawRenderer,
    isContentImagePreserveForced
  });
}
