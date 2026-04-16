import { deepRecord, isPolymerElement, isRecord } from "../helpers";
import type { VideoSnapshot } from "../types";
import { findItemElement } from "./query";

function updateLockupMetadata(elParent: HTMLElement, viewCountText: string, publishedTimeText: string) {
  const elMetadataContent = elParent.querySelector("yt-content-metadata-view-model");
  if (!elMetadataContent) {
    return;
  }

  const elMetaTextSpans = elMetadataContent.querySelectorAll<HTMLElement>(".yt-content-metadata-view-model__metadata-text:not(:has(*))");

  for (let iSpan = 0; iSpan < elMetaTextSpans.length; iSpan++) {
    if (elMetaTextSpans[iSpan].textContent?.toLowerCase().includes(" view")) {
      elMetaTextSpans[iSpan].textContent = viewCountText;
      const elTimestampSpan = elMetaTextSpans[iSpan + 1];
      if (elTimestampSpan) {
        elTimestampSpan.textContent = publishedTimeText;
      }

      return;
    }
  }
}

export async function updateVideoInDom(videoId: string, freshSnapshot: VideoSnapshot, isVisualChange: boolean) {
  const elItem = findItemElement(videoId);
  if (!elItem || !isPolymerElement(elItem)) {
    return;
  }

  const elPolymerItem = elItem;
  const { rawRenderer } = freshSnapshot;

  function applyUpdate() {
    const itemData = elPolymerItem.data;
    if (!isRecord(itemData)) {
      return;
    }

    const { content } = itemData;
    if (!isRecord(content)) {
      elPolymerItem.set("data", rawRenderer);
    } else if (isRecord(content.lockupViewModel)) {
      elPolymerItem.set("data.content.lockupViewModel", rawRenderer);
      updateLockupMetadata(elPolymerItem, freshSnapshot.viewCountText, freshSnapshot.publishedTimeText);
    } else if (isRecord(content.videoRenderer)) {
      elPolymerItem.set("data.content.videoRenderer", rawRenderer);
    } else if (isRecord(content.gridVideoRenderer)) {
      elPolymerItem.set("data.content.gridVideoRenderer", rawRenderer);
    } else {
      const richGridMedia = deepRecord(content, "richGridMediaRenderer");
      if (richGridMedia) {
        elPolymerItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
      }
    }
  }

  if (isVisualChange) {
    elPolymerItem.style.viewTransitionName = `ytsua-item-${videoId}`;
    try {
      await document.startViewTransition(applyUpdate).finished;
    } finally {
      elPolymerItem.style.viewTransitionName = "";
    }
  } else {
    applyUpdate();
  }
}
