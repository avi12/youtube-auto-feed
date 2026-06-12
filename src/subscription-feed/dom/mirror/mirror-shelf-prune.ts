import { isAnimationsEnabled } from "../../settings-state";
import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isRichShelfData } from "../../youtube-api/guards";
import { fetchVideoChannel } from "../../youtube-api/oembed";
import { richShelfDataSchema } from "../../youtube-api/schemas";
import { resolveChannelSubscription, SubscriptionVerdict } from "../../youtube-api/watch-page-subscription";
import { channelIdsFromRichItem, videoIdFromRichItem } from "../rich-item";
import { animateShelfRemoval } from "./mirror-shelf-remove";

// Rich shelves (Most relevant, Shorts) keep their own video copies, so unsubscribing from a channel or a
// video being deleted has to be reconciled here - the inline reflow only touches the Latest band, which
// stays driven purely by API mirroring. YouTube also inconsistently omits still-valid shelf videos from a
// poll, so absence alone is not trusted to mean "gone". Each shelf video is kept while it is BOTH from a
// still-subscribed channel AND still present.
//
// Subscription is the authoritative signal and comes from the video's watch page, which carries the real
// subscribed flag for the uploader and for every collaborator on a collab video - the video stays while
// any one of them is subscribed. That lives in watch-page-subscription, cached per channel and capped per
// poll. Deletion is a separate check: a Short (no lockup channel) or a video missing from this poll is run
// through a light oEmbed call whose 404 means genuinely gone. A restriction-only or transient failure
// leaves the video available and subscribed-state unknown, so it is kept; insertion stays Latest-only -
// this step never adds to a shelf.

const RESOLVED_TRUST_MS = 5 * 60 * 1000;
const MAX_AVAILABILITY_CHECKS_PER_POLL = 16;

interface CachedAvailability {
  isAvailable: boolean;
  until: number;
}

interface ShelfVideo {
  videoId: string;
  lockupChannelIds: string[];
  isAbsent: boolean;
}

interface PruneBudget {
  availabilityChecks: number;
  watchPageChecks: number;
}

const availabilityByVideoId = new Map<string, CachedAvailability>();

function usableShelves() {
  return [...document.querySelectorAll<PolymerElement>("ytd-rich-shelf-renderer")]
    .filter(elShelf => richShelfDataSchema.safeParse(elShelf.data).success);
}

function collectApiVideoIds(apiContents: Prettify<InnerTubeRichGridItem>[]) {
  const videoIds = new Set<string>();
  for (const item of apiContents) {
    const inlineId = videoIdFromRichItem(item);
    if (inlineId) {
      videoIds.add(inlineId);
    }

    for (const shelfItem of item.richSectionRenderer?.content?.richShelfRenderer?.contents ?? []) {
      const shelfId = videoIdFromRichItem(shelfItem);
      if (shelfId) {
        videoIds.add(shelfId);
      }
    }
  }
  return videoIds;
}

function collectShelfVideos(elShelves: PolymerElement[], apiVideoIds: Set<string>) {
  const shelfVideos: ShelfVideo[] = [];
  const seen = new Set<string>();
  for (const elShelf of elShelves) {
    if (!isRichShelfData(elShelf.data)) {
      continue;
    }

    for (const item of elShelf.data.contents ?? []) {
      const videoId = videoIdFromRichItem(item);
      if (videoId && !seen.has(videoId)) {
        seen.add(videoId);
        shelfVideos.push({
          videoId,
          lockupChannelIds: channelIdsFromRichItem(item),
          isAbsent: !apiVideoIds.has(videoId)
        });
      }
    }
  }
  return shelfVideos;
}

function forgetDepartedVideos(presentVideoIds: Set<string>) {
  for (const videoId of availabilityByVideoId.keys()) {
    if (!presentVideoIds.has(videoId)) {
      availabilityByVideoId.delete(videoId);
    }
  }
}

// oEmbed reports whether a video still exists: a 404 means it is genuinely gone. The verdict is cached for
// a trust window and the calls are capped per poll, so a first load of many Shorts spreads over a couple
// of polls rather than firing dozens of requests at once. When the budget is spent, an earlier result is
// reused; an unknown video is treated as available so a valid video is never dropped on a transient miss.
async function isDeleted(videoId: string, budget: PruneBudget) {
  const remembered = availabilityByVideoId.get(videoId);
  if (remembered && remembered.until > Date.now()) {
    return !remembered.isAvailable;
  }

  if (budget.availabilityChecks >= MAX_AVAILABILITY_CHECKS_PER_POLL) {
    return false;
  }

  budget.availabilityChecks++;
  const { isAvailable } = await fetchVideoChannel(videoId);
  availabilityByVideoId.set(videoId, {
    isAvailable,
    until: Date.now() + RESOLVED_TRUST_MS
  });
  return !isAvailable;
}

// A shelf video is removable when it is genuinely deleted or when its channel is no longer subscribed. A
// regular video's lockup carries its channel ids (every collaborator's, for a collab), so subscription is
// settled from the watch page; a Short carries none and falls back to the owner the probe reports. The
// deletion check runs only for Shorts and videos absent from this poll - a present regular video is known
// to exist. An unknown subscription verdict keeps the video, so a transient failure never removes it.
async function isRemovable(video: ShelfVideo, budget: PruneBudget) {
  if ((video.lockupChannelIds.length === 0 || video.isAbsent) && await isDeleted(video.videoId, budget)) {
    return true;
  }

  const verdict = await resolveChannelSubscription(video.lockupChannelIds, video.videoId, budget);
  return verdict === SubscriptionVerdict.Unsubscribed;
}

function applyShelfRemovals(removableVideoIds: Set<string>) {
  for (const elShelf of usableShelves()) {
    if (!isRichShelfData(elShelf.data)) {
      continue;
    }

    const { contents = [] } = elShelf.data;
    const removedVideoIds = new Set<string>();
    const retained = contents.filter(item => {
      const videoId = videoIdFromRichItem(item);
      const isRemoved = !!videoId && removableVideoIds.has(videoId);
      if (isRemoved) {
        removedVideoIds.add(videoId);
      }

      return !isRemoved;
    });
    if (removedVideoIds.size === 0) {
      continue;
    }

    if (!isAnimationsEnabled()) {
      elShelf.set("data.contents", retained);
      continue;
    }

    animateShelfRemoval({
      elShelf,
      retained,
      removedVideoIds
    }).catch(() => {});
  }
}

export async function pruneUnsubscribedShelfVideos(apiContents: Prettify<InnerTubeRichGridItem>[]) {
  if (apiContents.length === 0) {
    return;
  }

  const elShelves = usableShelves();
  if (elShelves.length === 0) {
    return;
  }

  const shelfVideos = collectShelfVideos(elShelves, collectApiVideoIds(apiContents));
  forgetDepartedVideos(new Set(shelfVideos.map(video => video.videoId)));

  const budget: PruneBudget = {
    availabilityChecks: 0,
    watchPageChecks: 0
  };
  const verdicts = await Promise.all(
    shelfVideos.map(async video => ({
      videoId: video.videoId,
      isRemovable: await isRemovable(video, budget)
    }))
  );
  const removableVideoIds = new Set(
    verdicts.filter(verdict => verdict.isRemovable).map(verdict => verdict.videoId)
  );
  if (removableVideoIds.size === 0) {
    return;
  }

  applyShelfRemovals(removableVideoIds);
}
