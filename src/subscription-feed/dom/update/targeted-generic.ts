import type { Prettify } from "../../types/prettify";
import { isThumbnailChanged } from "../rich-item";
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
import { findThumbnailImgInItem, isTileHovered, preloadImage } from "./thumbnail";

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
  const elImg = isThumbnailChanging ? findThumbnailImgInItem(elItem) : null;
  // Thumbnail changed but <img> not found - rebuild the whole renderer.
  if (isThumbnailChanging && !elImg) {
    rebuildPolymerRenderer({
      videoId,
      elItem,
      rawRenderer
    });
    return;
  }

  // The refreshed picture is swapped in instantly (no crossfade) - preload it so Polymer's repaint
  // lands already decoded, and hold off while hovering so the hover preview is not disrupted.
  const isThumbnailSwapping = !!elImg && !isTileHovered(elItem);
  if (isThumbnailSwapping) {
    await preloadImage(thumbnailUrl);
  }

  const isAnimatable = textElements.length > 0 || isThumbnailSwapping;
  if (!isAnimatable) {
    // Thumbnail changed under the pointer - sync the model only, leave the DOM <img> alone.
    if (elImg) {
      syncGridModelItem({
        videoId,
        rawRenderer,
        forcePreserveContentImage: true
      });
    }

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
