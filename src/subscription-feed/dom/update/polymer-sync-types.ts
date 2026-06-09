import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";

type RawRenderer = Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;

export type ApplyToContainerParams = Prettify<{
  videoId: string;
  rawRenderer: RawRenderer;
  forcePreserveContentImage: boolean;
}>;
