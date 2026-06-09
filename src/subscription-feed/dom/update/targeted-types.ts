import type { PolymerElement } from "../../types/polymer";
import type { VideoSnapshot } from "../../types/video";

export interface TargetedUpdateParams {
  videoId: string;
  elItem: PolymerElement;
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}
