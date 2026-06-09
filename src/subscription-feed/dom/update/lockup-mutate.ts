import { z } from "../../../shared/zod";
import type { InnerTubeRichGridItem, LockupViewModel } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray } from "../../utils/records";
import { isLockupViewModel } from "../../youtube-api/guards";
import { gridDataSchema, richItemContentSchema, richShelfDataSchema } from "../../youtube-api/schemas";
import { findRichItemIndex } from "../rich-item";
import { mutateLockupViewModelInPlace } from "./lockup-mutate-in-place";

// mutateLockupMetadata walks every location where the lockup lives: the element's own data, the
// grid's data.contents, and every rich shelf's contents.

type MutateLockupMetadataParams = Prettify<{
  videoId: string;
  elItem: PolymerElement;
  incoming: Prettify<LockupViewModel>;
  preserveContentImage: boolean;
}>;

const itemDataSchema = z.looseObject({
  content: richItemContentSchema.optional().catch(undefined)
});

type MutateLockupsInContainersParams = Prettify<{
  selector: string;
  isUsable: (data: unknown) => boolean;
  videoId: string;
  mutateOne: (candidate: unknown) => void;
}>;

function mutateLockupsInContainers({ selector, isUsable, videoId, mutateOne }: MutateLockupsInContainersParams) {
  for (const elContainer of document.querySelectorAll<HTMLElement>(selector)) {
    if (!isPolymerElement(elContainer) || !isUsable(elContainer.data)) {
      continue;
    }

    const contents = deepArray<InnerTubeRichGridItem>(elContainer.data, "contents");
    const iItem = findRichItemIndex({
      contents,
      videoId
    });
    const content = iItem < 0 ? undefined : contents[iItem]?.richItemRenderer?.content;
    if (content) {
      mutateOne(content.lockupViewModel);
    }
  }
}

export function mutateLockupMetadata({ videoId, elItem, incoming, preserveContentImage }: MutateLockupMetadataParams) {
  const seenLockups = new Set<LockupViewModel>();
  function mutateOne(candidate: unknown) {
    const isReusableLockup = isLockupViewModel(candidate) && !seenLockups.has(candidate);
    if (!isReusableLockup) {
      return;
    }

    seenLockups.add(candidate);
    mutateLockupViewModelInPlace({
      existing: candidate,
      incoming,
      preserveContentImage
    });
  }

  const itemDataParse = itemDataSchema.safeParse(elItem.data);
  if (itemDataParse.success) {
    mutateOne(itemDataParse.data.content?.lockupViewModel);
  }

  mutateLockupsInContainers({
    selector: "ytd-rich-grid-renderer",
    isUsable: data => gridDataSchema.safeParse(data).success,
    videoId,
    mutateOne
  });
  mutateLockupsInContainers({
    selector: "ytd-rich-shelf-renderer",
    isUsable: data => richShelfDataSchema.safeParse(data).success,
    videoId,
    mutateOne
  });
}
