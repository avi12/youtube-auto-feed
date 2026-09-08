import { isAnimationsEnabled } from "../../settings-state";
import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isRichShelfData } from "../../youtube-api/guards";
import { fetchVideoChannel } from "../../youtube-api/oembed";
import { richShelfDataSchema } from "../../youtube-api/schemas";
import { resolveSubscribedChannels, type SubscribedChannels } from "../../youtube-api/subscribed-channels";
import { channelIdsFromRichItem, videoIdFromRichItem } from "../rich-item";
import { animateShelfRemoval } from "./mirror-shelf-remove";

// Rich shelves (Most relevant, Shorts) keep their own video copies, so unsubscribing from a channel or a
// video being deleted has to be reconciled here - the inline reflow only touches the Latest band, which
// stays driven purely by API mirroring. YouTube also inconsistently omits still-valid shelf videos from a
// poll, so absence alone is not trusted to mean "gone". Each shelf video is kept while it is BOTH from a
// still-subscribed channel AND still present.
//
// Subscription is settled locally against the viewer's subscribed-channel set, which one guide call
// returns whole. A regular video's lockup carries its channel ids - every collaborator's, for a collab -
// so the video stays while any one of them is subscribed. A Short carries none, and its uploader comes
// from the same light oEmbed call that reports deletion, matched by handle. Deletion is checked only for
// a Short or a video missing from this poll; a present regular video is known to exist. A restriction-only
// or transient failure leaves the video available and its channel unknown, so it is kept; insertion stays
// Latest-only - this step never adds to a shelf.

const RESOLVED_TRUST_MS = 5 * 60 * 1000;
const MAX_CHANNEL_LOOKUPS_PER_POLL = 16;

interface CachedVideoChannel {
  handle: string | null;
  isAvailable: boolean;
  until: number;
}

interface ShelfVideo {
  videoId: string;
  lockupChannelIds: string[];
  isAbsent: boolean;
}

interface PruneBudget {
  channelLookups: number;
}

const channelByVideoId = new Map<string, CachedVideoChannel>();

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

type CollectShelfVideosParams = Prettify<{
  elShelves: PolymerElement[];
  apiVideoIds: Set<string>;
}>;

function collectShelfVideos({ elShelves, apiVideoIds }: CollectShelfVideosParams) {
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
  for (const videoId of channelByVideoId.keys()) {
    if (!presentVideoIds.has(videoId)) {
      channelByVideoId.delete(videoId);
    }
  }
}

// oEmbed reports a video's uploader handle and whether it still exists - a 404 means it is genuinely
// gone. The verdict is cached for a trust window and the calls are capped per poll, so a first load of
// many Shorts spreads over a couple of polls rather than firing dozens of requests at once. When the
// budget is spent nothing is known about the video, and the caller keeps it.
type LookupVideoChannelParams = Prettify<{
  videoId: string;
  budget: PruneBudget;
}>;

async function lookupVideoChannel({ videoId, budget }: LookupVideoChannelParams) {
  const remembered = channelByVideoId.get(videoId);
  if (remembered && remembered.until > Date.now()) {
    return remembered;
  }

  if (budget.channelLookups >= MAX_CHANNEL_LOOKUPS_PER_POLL) {
    return null;
  }

  budget.channelLookups++;
  const { handle, isAvailable } = await fetchVideoChannel(videoId);
  const resolved = {
    handle,
    isAvailable,
    until: Date.now() + RESOLVED_TRUST_MS
  };
  channelByVideoId.set(videoId, resolved);
  return resolved;
}

// A shelf video is removable when it is genuinely deleted or when none of its channels is subscribed.
// The oEmbed lookup runs only where it can decide something: a Short, whose uploader it is the only
// source for, or a video the poll dropped, which it can confirm as deleted.
type IsRemovableParams = Prettify<{
  video: ShelfVideo;
  subscribed: SubscribedChannels;
  budget: PruneBudget;
}>;

async function isRemovable({ video, subscribed, budget }: IsRemovableParams) {
  const isLookupNeeded = video.lockupChannelIds.length === 0 || video.isAbsent;
  const resolved = isLookupNeeded
    ? await lookupVideoChannel({
      videoId: video.videoId,
      budget
    })
    : null;
  if (resolved && !resolved.isAvailable) {
    return true;
  }

  if (video.lockupChannelIds.length > 0) {
    return !video.lockupChannelIds.some(channelId => subscribed.channelIds.has(channelId));
  }

  return !!resolved?.handle && !subscribed.handles.has(resolved.handle);
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

  // Without the subscribed set every video would read as unsubscribed, which would empty the shelves.
  const subscribed = await resolveSubscribedChannels();
  if (!subscribed) {
    return;
  }

  const shelfVideos = collectShelfVideos({
    elShelves,
    apiVideoIds: collectApiVideoIds(apiContents)
  });
  forgetDepartedVideos(new Set(shelfVideos.map(video => video.videoId)));

  const budget: PruneBudget = { channelLookups: 0 };
  const verdicts = await Promise.all(
    shelfVideos.map(async video => ({
      videoId: video.videoId,
      isRemovable: await isRemovable({
        video,
        subscribed,
        budget
      })
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
