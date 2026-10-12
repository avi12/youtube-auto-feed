import type { Prettify } from "../../types/prettify";
import { videoIdFromWatchHref } from "../../utils/video-id";
import { endScreenVideosFromWatchNext, type EndScreenVideo } from "../../youtube-api/parse-watch-next";
import { applyWithDissolve, setNodeTextIfChanged } from "../update/dissolve";
import { crossfadeBackgroundImage } from "../update/thumbnail";
import { pageWatchNext } from "./current-video";
import { findPlayer, paintedBackgroundUrl, refreshPlayerPicture } from "./player-pictures";

// The suggestions the player shows when a video finishes: the end-screen wall (the current grid and the
// older wall it replaced) and the "Up next" autoplay card. The player builds them once from the page's
// /next copy and composes their detail lines itself ("28M • 6y ago", "Channel • 28M"), so a detail line is
// refreshed by swapping just the view count and date it shows for the current ones - never rebuilt -
// which keeps the player's own wording and order. What each tile shows is remembered per video, falling
// back to the page's copy the player built it from.

interface EndScreenTileLayout {
  tileSelector: string;
  imageSelector: string;
  titleSelector: string;
  detailSelectors: string[];
}

const END_SCREEN_TILE_LAYOUTS: EndScreenTileLayout[] = [
  {
    tileSelector: "a.ytp-modern-videowall-still",
    imageSelector: ".ytp-modern-videowall-still-image",
    titleSelector: ".ytp-modern-videowall-still-info-title",
    detailSelectors: [".ytp-modern-videowall-still-info-author", ".ytp-modern-videowall-still-view-count-and-date-info"]
  },
  {
    tileSelector: "a.ytp-videowall-still",
    imageSelector: ".ytp-videowall-still-image",
    titleSelector: ".ytp-videowall-still-info-title",
    detailSelectors: [".ytp-videowall-still-info-author"]
  },
  {
    tileSelector: ".ytp-autonav-endscreen-upnext-container",
    imageSelector: ".ytp-autonav-endscreen-upnext-thumbnail",
    titleSelector: ".ytp-autonav-endscreen-upnext-title",
    detailSelectors: [".ytp-autonav-view-and-date", ".ytp-autonav-author-and-view"]
  }
];

const paintedByVideoId = new Map<string, Prettify<EndScreenVideo>>();
let checkedPictures = new WeakSet<HTMLElement>();

export function resetEndScreenTracking() {
  paintedByVideoId.clear();
  checkedPictures = new WeakSet();
}

interface EndScreenTile {
  elTile: HTMLElement;
  layout: EndScreenTileLayout;
  videoId: string;
}

function readEndScreenTiles() {
  const elPlayer = findPlayer();
  const tiles: EndScreenTile[] = [];
  for (const layout of END_SCREEN_TILE_LAYOUTS) {
    for (const elTile of elPlayer?.querySelectorAll<HTMLElement>(layout.tileSelector) ?? []) {
      const href = elTile instanceof HTMLAnchorElement ? elTile.href : elTile.querySelector("a")?.href;
      const videoId = videoIdFromWatchHref(href);
      if (videoId) {
        tiles.push({
          elTile,
          layout,
          videoId
        });
      }
    }
  }
  return tiles;
}

function isPartShown(text: string, part: string) {
  return part !== "" && text.includes(part);
}

type RefreshedDetailParams = Prettify<{
  text: string;
  shownVersions: Prettify<EndScreenVideo>[];
  fresh: Prettify<EndScreenVideo>;
}>;

function refreshedDetail({ text, shownVersions, fresh }: RefreshedDetailParams) {
  const shown = shownVersions.find(version =>
    isPartShown(text, version.viewCountText) || isPartShown(text, version.publishedTimeText));
  if (!shown) {
    return text;
  }

  const parts = [
    [shown.viewCountText, fresh.viewCountText],
    [shown.publishedTimeText, fresh.publishedTimeText]
  ] as const;
  return parts.reduce((refreshed, [shownPart, freshPart]) => {
    const isPartRefreshable = isPartShown(refreshed, shownPart) && freshPart !== "";
    return isPartRefreshable ? refreshed.replace(shownPart, freshPart) : refreshed;
  }, text);
}

function pathOf(url: string) {
  return new URL(url, location.origin).pathname;
}

type RefreshEndScreenTileParams = Prettify<EndScreenTile & {
  shownVersions: Prettify<EndScreenVideo>[];
  fresh: Prettify<EndScreenVideo>;
}>;

async function refreshEndScreenTile({ elTile, layout, shownVersions, fresh }: RefreshEndScreenTileParams) {
  const textChanges = new Map<HTMLElement, string>();
  const elTitle = elTile.querySelector<HTMLElement>(layout.titleSelector);
  if (elTitle && fresh.title !== "" && elTitle.textContent !== fresh.title) {
    textChanges.set(elTitle, fresh.title);
  }

  for (const detailSelector of layout.detailSelectors) {
    const elDetail = elTile.querySelector<HTMLElement>(detailSelector);
    const text = elDetail?.textContent ?? "";
    const refreshed = refreshedDetail({
      text,
      shownVersions,
      fresh
    });
    if (elDetail && refreshed !== text) {
      textChanges.set(elDetail, refreshed);
    }
  }

  applyWithDissolve({
    elements: [...textChanges.keys()],
    apply() {
      for (const [elNode, newText] of textChanges) {
        setNodeTextIfChanged({
          elNode,
          newText
        });
      }
    }
  });

  const elImage = elTile.querySelector<HTMLElement>(layout.imageSelector);
  const isPictureMoved = !!elImage && fresh.thumbnailUrl !== ""
    && pathOf(paintedBackgroundUrl(elImage)) !== pathOf(fresh.thumbnailUrl);
  if (elImage && isPictureMoved) {
    await crossfadeBackgroundImage({
      elImage,
      src: fresh.thumbnailUrl
    });
  }
}

export async function applyEndScreenUpdates(freshVideos: Map<string, Prettify<EndScreenVideo>>) {
  const watchNext = pageWatchNext();
  const pageVideos = watchNext ? endScreenVideosFromWatchNext(watchNext) : new Map<string, Prettify<EndScreenVideo>>();
  const refreshes: Promise<void>[] = [];
  for (const tile of readEndScreenTiles()) {
    const fresh = freshVideos.get(tile.videoId);
    if (!fresh) {
      continue;
    }

    const shownVersions = [paintedByVideoId.get(tile.videoId), pageVideos.get(tile.videoId)]
      .filter(version => version !== undefined);
    refreshes.push(
      refreshEndScreenTile({
        ...tile,
        shownVersions,
        fresh
      })
    );
  }
  await Promise.all(refreshes);

  for (const fresh of freshVideos.values()) {
    paintedByVideoId.set(fresh.videoId, fresh);
  }
}

// Same-URL picture swaps on the tiles actually on screen. Pressing V on the end screen expands it into
// the full suggestion grid, so a tile first seen since the last check is checked on the next poll
// instead of waiting for the slower re-check of every tile.
export async function refreshEndScreenPictures(isRecheckDue: boolean) {
  if (isRecheckDue) {
    checkedPictures = new WeakSet();
  }

  const elImages = readEndScreenTiles().flatMap(({ elTile, layout }) => {
    const elImage = elTile.querySelector<HTMLElement>(layout.imageSelector);
    return elImage?.checkVisibility() && !checkedPictures.has(elImage) ? [elImage] : [];
  });
  for (const elImage of elImages) {
    checkedPictures.add(elImage);
  }
  await Promise.all(elImages.map(refreshPlayerPicture));
}
