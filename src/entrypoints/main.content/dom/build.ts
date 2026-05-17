import { isLockupViewModel, isShortsLockupViewModel } from "../api/guards";
import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "../types";

export function buildRichItem(rawRenderer: InnerTubeVideoRenderer | LockupViewModel | ShortsLockupViewModel) {
  let content;
  if (isLockupViewModel(rawRenderer)) {
    content = { lockupViewModel: rawRenderer };
  } else if (isShortsLockupViewModel(rawRenderer)) {
    content = { shortsLockupViewModel: rawRenderer };
  } else {
    content = { videoRenderer: rawRenderer };
  }

  return {
    richItemRenderer: {
      content,
      trackingParams: ""
    }
  };
}
