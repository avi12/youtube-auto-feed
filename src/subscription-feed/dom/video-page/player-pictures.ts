import { crossfadeBackgroundImage, fetchChangedThumbnailBytes } from "../update/thumbnail";

// The player paints its pictures - the poster shown before playback starts, the suggestions on its end
// screen - as CSS backgrounds under URLs that never change when a creator replaces the thumbnail. So the
// bytes decide: a picture whose URL now serves something else is crossfaded to those bytes from a
// one-shot object URL, remembered against the real URL so the next check asks about that one again.

const PLAYER_SELECTOR = "#movie_player";
const CUED_THUMBNAIL_SELECTOR = ".ytp-cued-thumbnail-overlay-image";
const BACKGROUND_URL_PATTERN = /^url\("(.+)"\)$/;

export enum PlayerMode {
  Unstarted = "unstarted-mode",
  Cued = "cued-mode",
  Ended = "ended-mode"
}

const sourceUrlByObjectUrl = new Map<string, string>();

export function findPlayer() {
  return document.querySelector<HTMLElement>(PLAYER_SELECTOR);
}

export function isPlayerInMode(...modes: PlayerMode[]) {
  const elPlayer = findPlayer();
  return !!elPlayer && modes.some(mode => elPlayer.classList.contains(mode));
}

export function isMainPlayerVideo(target: EventTarget | null) {
  return target instanceof HTMLVideoElement && !!target.closest(PLAYER_SELECTOR);
}

export function paintedBackgroundUrl(elImage: HTMLElement) {
  const painted = BACKGROUND_URL_PATTERN.exec(elImage.style.backgroundImage)?.[1] ?? "";
  return sourceUrlByObjectUrl.get(painted) ?? painted;
}

export async function refreshPlayerPicture(elImage: HTMLElement) {
  const url = paintedBackgroundUrl(elImage);
  const buffer = url ? await fetchChangedThumbnailBytes(url) : null;
  if (!buffer) {
    return;
  }

  const objectUrl = URL.createObjectURL(new Blob([buffer]));
  const isPainted = await crossfadeBackgroundImage({
    elImage,
    src: objectUrl
  });
  if (!isPainted) {
    URL.revokeObjectURL(objectUrl);
    return;
  }

  sourceUrlByObjectUrl.set(objectUrl, url);
}

// Before playback starts the player shows the video's thumbnail as its poster.
export async function refreshUnstartedPlayerThumbnail() {
  if (!isPlayerInMode(PlayerMode.Unstarted, PlayerMode.Cued)) {
    return;
  }

  const elImage = findPlayer()?.querySelector<HTMLElement>(CUED_THUMBNAIL_SELECTOR);
  if (elImage?.checkVisibility()) {
    await refreshPlayerPicture(elImage);
  }
}
