import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { applyPolymerUpdate, syncGridModelItem } from "./polymer-model";

// Full rebuild: refresh the bound element, then every other model copy of the same video.
type RebuildPolymerRendererParams = Prettify<{
  videoId: string;
  elItem: Prettify<PolymerElement>;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage?: boolean;
}>;

export function rebuildPolymerRenderer({
  videoId,
  elItem,
  rawRenderer,
  forcePreserveContentImage = false
}: RebuildPolymerRendererParams) {
  applyPolymerUpdate({
    elItem,
    rawRenderer
  });
  syncGridModelItem({
    videoId,
    rawRenderer,
    forcePreserveContentImage
  });
}
