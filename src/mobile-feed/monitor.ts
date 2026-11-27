import { z } from "@/shared/zod";
import { createGuard } from "@/shared/zod-guard";
import { POLL_INTERVAL_MS } from "@/subscription-feed/polling/polling-state";
import { isExtensionEnabled } from "@/subscription-feed/settings-state";
import { isOnSubscriptionsPage } from "@/subscription-feed/utils/subscriptions-page";
import { fetchSubscriptionsBrowse } from "@/subscription-feed/youtube-api/innertube-browse";

import { mergeFeed } from "./merge";
import {
  mobileBrowseResponseSchema,
  mobileGridElementSchema,
  mobileGridItemSchema,
  mobileTileElementSchema
} from "./schemas";

const GRID_SELECTOR = "ytm-rich-grid-renderer";
const GRID_CONTENTS_SELECTOR = ".rich-grid-renderer-contents";
// The renderer each kind of grid child draws
const RENDERER_KEY_BY_TAG = new Map([
  ["ytm-rich-item-renderer", "richItemRenderer"],
  ["ytm-rich-section-renderer", "richSectionRenderer"],
  ["ytm-continuation-item-renderer", "continuationItemRenderer"]
]);
// The mobile app resolves whatever command this event carries, as it does those in its own responses
const COMMAND_EVENT = "yt-innertube-command";
const RELOAD_SLOT = "RELOAD_CONTINUATION_SLOT_BODY";

const isBrowseResponse = createGuard(mobileBrowseResponseSchema);
const isGridElement = createGuard(mobileGridElementSchema);
const isTileElement = createGuard(mobileTileElementSchema);
const isGridContents = createGuard(z.array(mobileGridItemSchema));

// Read off the tiles: the grid's own data keeps the first page it was built with, through both
// scrolling and updates
function readGrid() {
  const elGrid = document.querySelector(GRID_SELECTOR);
  if (!isGridElement(elGrid)) {
    return null;
  }

  const elTiles = [...(elGrid.querySelector(GRID_CONTENTS_SELECTOR)?.children ?? [])];
  const contents = elTiles.flatMap(elTile => {
    const rendererKey = RENDERER_KEY_BY_TAG.get(elTile.localName);
    const isDrawnTile = !!rendererKey && isTileElement(elTile);
    return isDrawnTile ? [{ [rendererKey]: elTile.data }] : [];
  });
  const isReadable = isGridContents(contents);
  return isReadable
    ? {
        targetId: elGrid.data.targetId,
        contents
      }
    : null;
}

async function refreshFeed() {
  const response = await fetchSubscriptionsBrowse();
  if (!isBrowseResponse(response)) {
    return;
  }

  const fresh = response.contents.singleColumnBrowseResultsRenderer.tabs.flatMap(
    tab => tab.tabRenderer?.content?.richGridRenderer?.contents ?? []
  );
  // Read only now: scrolling may have grown the grid while the response was on its way
  const grid = isOnSubscriptionsPage() ? readGrid() : null;
  const continuationItems =
    grid &&
    mergeFeed({
      current: grid.contents,
      fresh
    });
  if (!continuationItems) {
    return;
  }

  const detail = {
    reloadContinuationItemsCommand: {
      targetId: grid.targetId,
      continuationItems,
      slot: RELOAD_SLOT
    }
  };
  dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail }));
}

export function startMobileFeedMonitor() {
  async function poll() {
    const isWatching = isExtensionEnabled() && !document.hidden && isOnSubscriptionsPage();
    if (isWatching) {
      await refreshFeed().catch(() => {});
    }

    setTimeout(poll, POLL_INTERVAL_MS);
  }

  setTimeout(poll, POLL_INTERVAL_MS);
}
