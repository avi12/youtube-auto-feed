import type { PolymerElement, VideoSnapshot } from "../types";
import { clearAllItemViewTransitionNames } from "../animations";
import { deepRecord, isPolymerElement, isRecord } from "../helpers";
import { findItemElement } from "./query";

function applyPolymerUpdate(elItem: PolymerElement, rawRenderer: VideoSnapshot["rawRenderer"]) {
  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    return;
  }

  const { content } = itemData;
  if (!isRecord(content)) {
    elItem.set("data", rawRenderer);
  } else if (isRecord(content.lockupViewModel)) {
    elItem.set("data.content.lockupViewModel", rawRenderer);
  } else if (isRecord(content.shortsLockupViewModel)) {
    elItem.set("data.content.shortsLockupViewModel", rawRenderer);
  } else if (isRecord(content.videoRenderer)) {
    elItem.set("data.content.videoRenderer", rawRenderer);
  } else if (isRecord(content.gridVideoRenderer)) {
    elItem.set("data.content.gridVideoRenderer", rawRenderer);
  } else {
    const richGridMedia = deepRecord(content, "richGridMediaRenderer");
    if (richGridMedia) {
      elItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
    }
  }
}

export async function updateVideoInDom(videoId: string, freshSnapshot: VideoSnapshot) {
  const elItem = findItemElement(videoId);
  if (!elItem || !isPolymerElement(elItem)) {
    return;
  }

  clearAllItemViewTransitionNames();
  elItem.style.viewTransitionName = `ytsua-item-${videoId}`;
  try {
    await document.startViewTransition(async () => {
      applyPolymerUpdate(elItem, freshSnapshot.rawRenderer);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }).finished;
  } finally {
    elItem.style.viewTransitionName = "";
    clearAllItemViewTransitionNames();
  }
}

export async function batchUpdateVideosInDom(freshSnapshots: VideoSnapshot[]) {
  clearAllItemViewTransitionNames();

  const updates: Array<{ fresh: VideoSnapshot; elItem: PolymerElement }> = [];
  for (const fresh of freshSnapshots) {
    const elItem = findItemElement(fresh.videoId);
    if (!elItem || !isPolymerElement(elItem)) {
      continue;
    }
    elItem.style.viewTransitionName = `ytsua-item-${fresh.videoId}`;
    updates.push({ fresh, elItem });
  }

  if (updates.length === 0) {
    return;
  }

  try {
    await document.startViewTransition(async () => {
      for (const { fresh, elItem } of updates) {
        applyPolymerUpdate(elItem, fresh.rawRenderer);
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }).finished;
  } finally {
    for (const { elItem } of updates) {
      elItem.style.viewTransitionName = "";
    }
    clearAllItemViewTransitionNames();
  }
}
