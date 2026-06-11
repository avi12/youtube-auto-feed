import type { Prettify } from "../../types/prettify";
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
import { dissolveThumbnail, findThumbnailImgInItem, prepareThumbnailDissolve } from "./thumbnail";

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

  const isThumbnailChanging = previous.thumbnailUrl !== thumbnailUrl;
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

  const thumbWork = elImg
    ? prepareThumbnailDissolve({
      elItem,
      newUrl: thumbnailUrl
    })
    : null;
  const isAnimatable = textElements.length > 0 || !!thumbWork?.willDissolve;
  if (!isAnimatable) {
    // URL changed but bytes are the same - sync the model only, leave the DOM <img> alone.
    if (elImg && isThumbnailChanging) {
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
        forcePreserveContentImage: !thumbWork?.willDissolve
      });
    }
  });

  if (thumbWork?.willDissolve && elImg) {
    dissolveThumbnail(elImg, thumbWork.newUrl).catch(() => {});
  }
}
