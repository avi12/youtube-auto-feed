import { z } from "../../../shared/zod";
import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isLockupViewModel, isShortsLockupViewModel } from "../../youtube-api/guards";
import { richItemContentSchema } from "../../youtube-api/schemas";
import { mergeLockupViewModel } from "./lockup-model";

export { syncGridModelItem } from "./polymer-sync-model";

// Writes back into Polymer's data binding. A video may appear in the rich grid root, inside one or
// more rich shelves, and inside a legacy inner shelf; syncGridModelItem updates every position so
// Polymer re-renders all copies. applyPolymerUpdate is the preferred entry for element-bound updates.

const itemDataSchema = z.looseObject({ content: richItemContentSchema.optional().catch(undefined) });
const lockupHostSchema = z.looseObject({ lockupViewModel: z.looseObject({}) });
const shortsLockupHostSchema = z.looseObject({ shortsLockupViewModel: z.looseObject({}) });

type ApplyPolymerUpdateParams = Prettify<{
  elItem: Prettify<PolymerElement>;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
}>;

export function applyPolymerUpdate({ elItem, rawRenderer }: ApplyPolymerUpdateParams) {
  const parsedItemData = itemDataSchema.safeParse(elItem.data);
  if (!parsedItemData.success) {
    return;
  }

  const itemData = parsedItemData.data;
  const content = itemData.content;
  if (!content) {
    elItem.set("data", rawRenderer);
    return;
  }

  if (isLockupViewModel(content.lockupViewModel) && isLockupViewModel(rawRenderer)) {
    const merged = mergeLockupViewModel({
      existing: content.lockupViewModel,
      incoming: rawRenderer
    });
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup && lockupHostSchema.safeParse(elLockup).success) {
      Object.assign(elLockup, { lockupViewModel: merged });
      return;
    }

    elItem.set("data", {
      ...itemData,
      content: {
        ...content,
        lockupViewModel: merged
      }
    });
    return;
  }

  const isShortsLockupSwap = isShortsLockupViewModel(content.shortsLockupViewModel)
    && isShortsLockupViewModel(rawRenderer);
  if (isShortsLockupSwap) {
    const elShortsLockup = elItem.querySelector<HTMLElement>("yt-shorts-lockup-view-model");
    if (elShortsLockup && shortsLockupHostSchema.safeParse(elShortsLockup).success) {
      Object.assign(elShortsLockup, { shortsLockupViewModel: rawRenderer });
      return;
    }

    elItem.set("data", {
      ...itemData,
      content: {
        ...content,
        shortsLockupViewModel: rawRenderer
      }
    });
    return;
  }

  if (content.videoRenderer) {
    elItem.set("data.content.videoRenderer", rawRenderer);
    return;
  }

  if (content.gridVideoRenderer) {
    elItem.set("data.content.gridVideoRenderer", rawRenderer);
    return;
  }

  if (content.richGridMediaRenderer) {
    elItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
  }
}
