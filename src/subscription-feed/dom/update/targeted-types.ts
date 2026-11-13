import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { VideoSnapshot } from "@/subscription-feed/types/video";

export interface TargetedUpdateParams {
  videoId: string;
  elItem: PolymerElement;
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}
