// YouTube publishes some thumbnails under a custom variant path (hq720_custom_1.jpg and friends) that
// can stop serving while the standard hq720.jpg for the same video keeps working. A tile whose picture
// loses that race paints blank, and nothing re-requests it, so the blank outlives the outage -
// re-inserting the tile just repeats the failing request. Repointing a failed load at the standard
// path heals it immediately. Shorts variants (oar*) are left alone: their frames are vertical, so the
// 16:9 standard picture would be the wrong shape.
//
// A variant that stopped serving is not a failed load: i.ytimg.com answers it 404 with a decodable
// 120x90 grey placeholder as the body, so the <img> fires load, not error, and paints that placeholder
// stretched across the tile - which reads as a missing picture. Both signals heal: an error (a
// genuine transport failure) and a load that decodes at the placeholder's size. Watching only error
// left every rotted custom thumbnail grey for the life of the tab.
//
// Every failure is healed, not just the first one per image: a re-render writes the dead URL from the
// model back onto the same <img>, and a heal that only fired once would leave the tile blank from then
// on. The standard path is exempt from healing, which is what stops a failing hq720.jpg from bouncing
// back into itself - and a just-uploaded video, whose standard path serves the same placeholder until
// processing finishes, keeps its own URL so the content watch can swap the real picture in later.
//
// A picture that has failed once is remembered, so the next render is redirected before the request is
// made rather than after it fails. Without that the grid re-requests the same dead URL on every
// re-render, flashing the tile blank each time while the model keeps handing out the dead address.

const THUMBNAIL_URL_PATTERN = /^https?:\/\/i\.ytimg\.com\/vi\/([^/]+)\/([^?]+)/;
const STANDARD_THUMBNAIL_FILE = "hq720.jpg";
const HEALABLE_FILE_PREFIX = "hq720";
const PLACEHOLDER_THUMBNAIL_WIDTH = 120;
const PLACEHOLDER_THUMBNAIL_HEIGHT = 90;

const deadThumbnailPaths = new Set<string>();

function standardThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/${STANDARD_THUMBNAIL_FILE}`;
}

interface HealableThumbnail {
  videoId: string;
  pathKey: string;
}

function healableThumbnailFrom(src: string): HealableThumbnail | null {
  const match = THUMBNAIL_URL_PATTERN.exec(src);
  const videoId = match?.[1];
  const file = match?.[2];
  if (!videoId || !file || file === STANDARD_THUMBNAIL_FILE || !file.startsWith(HEALABLE_FILE_PREFIX)) {
    return null;
  }

  return {
    videoId,
    pathKey: `${videoId}/${file}`
  };
}

export function repointDeadThumbnail(elImg: HTMLImageElement) {
  const healable = healableThumbnailFrom(elImg.src);
  if (!healable) {
    return false;
  }

  deadThumbnailPaths.add(healable.pathKey);
  elImg.src = standardThumbnailUrl(healable.videoId);
  return true;
}

export function isDeadThumbnailUrl(url: string) {
  const healable = healableThumbnailFrom(url);
  return !!healable && deadThumbnailPaths.has(healable.pathKey);
}

function isPlaceholderDecode(elImg: HTMLImageElement) {
  return elImg.naturalWidth === PLACEHOLDER_THUMBNAIL_WIDTH
    && elImg.naturalHeight === PLACEHOLDER_THUMBNAIL_HEIGHT;
}

function healFailedThumbnail(e: Event) {
  const elImg = e.target;
  if (!(elImg instanceof HTMLImageElement)) {
    return;
  }

  repointDeadThumbnail(elImg);
}

function healPlaceholderThumbnailPaint(e: Event) {
  const elImg = e.target;
  if (!(elImg instanceof HTMLImageElement) || !isPlaceholderDecode(elImg)) {
    return;
  }

  repointDeadThumbnail(elImg);
}

function redirectKnownDeadThumbnail(elImg: HTMLImageElement) {
  const healable = healableThumbnailFrom(elImg.getAttribute("src") ?? "");
  if (!healable || !deadThumbnailPaths.has(healable.pathKey)) {
    return;
  }

  elImg.src = standardThumbnailUrl(healable.videoId);
}

export function startThumbnailHealer() {
  document.addEventListener("error", healFailedThumbnail, true);
  document.addEventListener("load", healPlaceholderThumbnailPaint, true);

  const observer = new MutationObserver(records => {
    for (const { target } of records) {
      if (target instanceof HTMLImageElement) {
        redirectKnownDeadThumbnail(target);
      }
    }
  });
  observer.observe(document.documentElement, {
    attributeFilter: ["src"],
    subtree: true
  });
}
