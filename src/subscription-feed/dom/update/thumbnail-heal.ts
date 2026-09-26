// YouTube publishes some thumbnails under a variant path (hq720_custom_1.jpg, hqdefault_custom_2.jpg,
// oar2.jpg and friends) that can stop serving while the family's default picture for the same video
// keeps working. A tile whose picture loses that race paints blank, and nothing re-requests it, so the
// blank outlives the outage - re-inserting the tile just repeats the failing request. Repointing a
// failed load at the family default heals it immediately.
//
// The fallback stays inside the variant's own family, so the replacement has the shape the tile was
// built for: a widescreen variant falls back to hq720.jpg or hqdefault.jpg, a vertical Shorts variant
// to oardefault.jpg or sardefault.jpg. Each family default is itself exempt, which is what stops a
// failing fallback from bouncing back into itself.
//
// A variant that stopped serving is not a failed load: i.ytimg.com answers it 404 with a decodable
// 120x90 grey placeholder as the body, so the <img> fires load, not error, and paints that placeholder
// stretched across the tile - which reads as a missing picture. Both signals heal: an error (a
// genuine transport failure) and a load that decodes at the placeholder's size. Watching only error
// left every rotted custom thumbnail grey for the life of the tab.
//
// Every failure is healed, not just the first one per image: a re-render writes the dead URL from the
// model back onto the same <img>, and a heal that only fired once would leave the tile blank from then
// on. A just-uploaded video, whose family default serves the same placeholder until processing
// finishes, keeps its own URL so the content watch can swap the real picture in later.
//
// A picture that has failed once is remembered, so the next render is redirected before the request is
// made rather than after it fails. Without that the grid re-requests the same dead URL on every
// re-render, flashing the tile blank each time while the model keeps handing out the dead address.
//
// That memo makes `healedThumbnailUrl` the single answer to "which picture does this URL paint", and
// everything that writes a thumbnail onto a tile has to ask it. A writer that paints the model's raw
// URL instead fights the healer: the healer's redirect is an attribute write, which wakes the writer's
// own src observer, which repaints the dead URL, which the healer redirects again. Both sides run at
// the microtask checkpoint, so that exchange never yields to a frame - the tab freezes and the
// renderer is killed.

const THUMBNAIL_URL_PATTERN = /^https?:\/\/i\.ytimg\.com\/vi\/([^/]+)\/([^?]+)/;
const PLACEHOLDER_THUMBNAIL_WIDTH = 120;
const PLACEHOLDER_THUMBNAIL_HEIGHT = 90;
// A variant heals to its own family's default picture, so the replacement keeps the shape the tile was
// laid out for. The first family whose name the file starts with wins, and a file that already is its
// family's default is not healable.
const DEFAULT_FILE_BY_FAMILY = [
  ["hqdefault", "hqdefault.jpg"],
  ["hq720", "hq720.jpg"],
  ["maxresdefault", "hqdefault.jpg"],
  ["oar", "oardefault.jpg"],
  ["sar", "sardefault.jpg"]
] as const;

const deadThumbnailPaths = new Set<string>();

interface HealableThumbnail {
  pathKey: string;
  fallbackUrl: string;
}

function healableThumbnailFrom(src: string): HealableThumbnail | null {
  const match = THUMBNAIL_URL_PATTERN.exec(src);
  const videoId = match?.[1];
  const file = match?.[2];
  if (!videoId || !file) {
    return null;
  }

  for (const [family, defaultFile] of DEFAULT_FILE_BY_FAMILY) {
    if (!file.startsWith(family) || file === defaultFile) {
      continue;
    }

    return {
      pathKey: `${videoId}/${file}`,
      fallbackUrl: `https://i.ytimg.com/vi/${videoId}/${defaultFile}`
    };
  }

  return null;
}

export function repointDeadThumbnail(elImg: HTMLImageElement) {
  const healable = healableThumbnailFrom(elImg.src);
  if (!healable) {
    return false;
  }

  deadThumbnailPaths.add(healable.pathKey);
  elImg.src = healable.fallbackUrl;
  return true;
}

export function healedThumbnailUrl(url: string) {
  const healable = healableThumbnailFrom(url);
  if (!healable || !deadThumbnailPaths.has(healable.pathKey)) {
    return url;
  }

  return healable.fallbackUrl;
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
  const paintedUrl = elImg.getAttribute("src") ?? "";
  const healedUrl = healedThumbnailUrl(paintedUrl);
  if (healedUrl === paintedUrl) {
    return;
  }

  elImg.src = healedUrl;
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
