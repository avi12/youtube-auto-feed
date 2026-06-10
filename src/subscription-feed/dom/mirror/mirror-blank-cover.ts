import { isPolymerElement } from "../../utils/polymer";
import { avatarUrlFromContent, thumbnailUrlFromContent } from "../rich-item";
import { GRID_ITEM_SELECTOR, type RichItemElement } from "./mirror-constants";
import { avatarImgInItem, isInReflowZone, thumbnailImgsInItem } from "./mirror-elements";
import { repaintInlineThumbnails } from "./mirror-thumbnails";

export function coverBlankImages() {
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    if (!isInReflowZone(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const { content } = elItem.data;
    const thumbnailUrl = thumbnailUrlFromContent(content);
    for (const elImg of thumbnailImgsInItem(elItem)) {
      coverImgWhileBlank(elImg, thumbnailUrl);
    }

    coverImgWhileBlank(avatarImgInItem(elItem), avatarUrlFromContent(content));
  }
}

function coverImgWhileBlank(elImg: HTMLImageElement | null, url: string) {
  if (!elImg || !url) {
    return;
  }

  const isImageReady = elImg.complete && elImg.naturalWidth > 0;
  if (isImageReady || elImg.style.backgroundImage) {
    return;
  }

  elImg.style.backgroundImage = `url("${url}")`;
  elImg.style.backgroundSize = "cover";
  elImg.style.backgroundPosition = "center";
  elImg.addEventListener("load", () => {
    elImg.style.backgroundImage = "";
    elImg.style.backgroundSize = "";
    elImg.style.backgroundPosition = "";
  }, { once: true });
}

export function observeAndCoverBlankImages(elGrid: HTMLElement) {
  const elContents = elGrid.querySelector("#contents");
  if (!elContents) {
    return null;
  }

  const observer = new MutationObserver(() => {
    repaintInlineThumbnails();
    coverBlankImages();
  });
  const observeConfig = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"]
  };
  observer.observe(elContents, observeConfig);

  // Avatars live inside lockup shadow roots, which a #contents subtree observer can't reach.
  for (const elLockup of elContents.querySelectorAll("yt-lockup-view-model")) {
    if (elLockup.shadowRoot) {
      observer.observe(elLockup.shadowRoot, observeConfig);
    }
  }
  return observer;
}
