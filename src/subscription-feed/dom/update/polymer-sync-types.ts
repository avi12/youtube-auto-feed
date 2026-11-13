import type {
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "@/subscription-feed/types/innertube";
import type { Prettify } from "@/subscription-feed/types/prettify";

type RawRenderer = Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;

export type ApplyToContainerParams = Prettify<{
  videoId: string;
  rawRenderer: RawRenderer;
  forcePreserveContentImage: boolean;
}>;
