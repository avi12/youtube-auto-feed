// YouTube publishes some thumbnails under a custom variant path (hq720_custom_1.jpg and friends) that
// intermittently 404s while the standard hq720.jpg for the same video keeps serving. A tile whose
// picture loses that race paints blank, and nothing re-requests it, so the blank outlives the outage -
// re-inserting the tile just repeats the failing request. Repointing a failed load at the standard
// path once heals it immediately. Shorts variants (oar*) are left alone: their frames are vertical, so
// the 16:9 standard picture would be the wrong shape.

const THUMBNAIL_URL_PATTERN = /^https?:\/\/i\.ytimg\.com\/vi\/([^/]+)\/([^?]+)/;
const STANDARD_THUMBNAIL_FILE = "hq720.jpg";
const HEALABLE_FILE_PREFIX = "hq720";

const healedImages = new WeakSet<HTMLImageElement>();

function healFailedThumbnail(e: Event) {
  const elImg = e.target;
  if (!(elImg instanceof HTMLImageElement) || healedImages.has(elImg)) {
    return;
  }

  const match = THUMBNAIL_URL_PATTERN.exec(elImg.src);
  const videoId = match?.[1];
  const file = match?.[2];
  if (!videoId || !file || file === STANDARD_THUMBNAIL_FILE || !file.startsWith(HEALABLE_FILE_PREFIX)) {
    return;
  }

  healedImages.add(elImg);
  elImg.src = `https://i.ytimg.com/vi/${videoId}/${STANDARD_THUMBNAIL_FILE}`;
}

export function startThumbnailHealer() {
  document.addEventListener("error", healFailedThumbnail, true);
}
