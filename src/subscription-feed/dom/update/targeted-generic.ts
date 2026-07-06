import type { Prettify } from "../../types/prettify";
import { isThumbnailChanged, isThumbnailUrlRotated } from "../rich-item";
import { applyWithDissolve } from "./dissolve";
import { syncGridModelItem } from "./polymer-model";
import { rebuildPolymerRenderer } from "./polymer-rebuild";
import type { TargetedUpdateParams } from "./targeted-types";
import {
  changingLegacyTextElements,
  changingShortsTextElements,
  updateLegacyRendererTextFields,
  updateShortsTextFields
} from "./text-fields";
import { crossfadeChangedThumbnail, findThumbnailImgInItem } from "./thumbnail";

type ApplyTargetedGenericUpdateParams = Prettify<TargetedUpdateParams>;

export async function applyTargetedGenericUpdate({
  videoId,
  elItem,
  previous,
  fresh
}: ApplyTargetedGenericUpdateParams) {
  const { rawRenderer, thumbnailUrl } = fresh;
  const isShorts = !!elItem.querySelector("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model");
  const textElements = isShorts
    ? changingShortsTextElements({
      elItem,
      fresh
    })
    : changingLegacyTextElements({
      elItem,
      fresh
    });
  const applyText = isShorts
    ? () => updateShortsTextFields({
      elItem,
      fresh
    })
    : () => updateLegacyRendererTextFields({
      elItem,
      fresh
    });

  const isThumbnailChanging = isThumbnailChanged({
    previousUrl: previous.thumbnailUrl,
    freshUrl: thumbnailUrl,
    freshStatus: fresh.status
  });
  const isThumbnailQueryRotated = isThumbnailUrlRotated({
    previousUrl: previous.thumbnailUrl,
    freshUrl: thumbnailUrl,
    freshStatus: fresh.status
  });
  const elImg = isThumbnailChanging || isThumbnailQueryRotated ? findThumbnailImgInItem(elItem) : null;
  // Thumbnail changed but <img> not found - rebuild the whole renderer.
  if (isThumbnailChanging && !elImg) {
    rebuildPolymerRenderer({
      videoId,
      elItem,
      rawRenderer
    });
    return;
  }

  // Hovered tiles never reach this point - the callers defer the whole update until unhover.
  const isThumbnailSwapping = !!elImg && await crossfadeChangedThumbnail({
    elImg,
    previousUrl: previous.thumbnailUrl,
    freshUrl: thumbnailUrl,
    isSamePathRotation: isThumbnailQueryRotated
  });

  const isAnimatable = textElements.length > 0 || isThumbnailSwapping;
  if (!isAnimatable) {
    return;
  }

  applyWithDissolve({
    elements: [...textElements],
    apply() {
      applyText();
      syncGridModelItem({
        videoId,
        rawRenderer,
        forcePreserveContentImage: !isThumbnailSwapping
      });
    }
  });
}
