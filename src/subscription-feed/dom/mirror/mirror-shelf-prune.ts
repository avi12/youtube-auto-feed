import { isAnimationsEnabled } from "../../settings-state";
import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray } from "../../utils/records";
import { fetchVideoChannel } from "../../youtube-api/oembed";
import { richShelfDataSchema } from "../../youtube-api/schemas";
import { getSubscribedChannelKeys } from "../../youtube-api/subscriptions";
import { channelIdsFromRichItem, videoIdFromRichItem } from "../rich-item";
import { animateShelfRemoval } from "./mirror-shelf-remove";

// Rich shelves (Most relevant, Shorts) keep their own video copies, so unsubscribing from a channel or a
// video being deleted has to be reconciled here - the inline reflow only touches the Latest band. YouTube
// also inconsistently omits still-valid shelf videos from a poll, so absence alone is not trusted to mean
// "gone". Each shelf video is kept only while it is BOTH from a subscribed channel AND still present.
//
// A regular video's channel id rides along in its lockup, so its subscription is settled for free. A Short
// carries none, and any video missing from this poll - to confirm it is genuinely deleted rather than just
// dropped - is resolved through a light oEmbed call that returns the uploader @handle and a 404-means-gone
// signal. The resolution is remembered (the handle is stable) and the calls are capped per poll, so the
// shelves are not re-resolved from scratch every 5s. oEmbed cannot report subscription, so the handle is
// tested against the subscribed-channel set; insertion stays Latest-only - this step never adds to a shelf.

const RESOLVED_TRUST_MS = 5 * 60 * 1000;
const MAX_RESOLVE_CHECKS_PER_POLL = 16;

interface ResolvedChannel {
  channelKeys: string[];
  isAvailable: boolean;
  until: number;
}

interface ShelfVideo {
  videoId: string;
  lockupChannelIds: string[];
  isAbsent: boolean;
}

const resolvedByVideoId = new Map<string, ResolvedChannel>();

function usableShelves() {
  return [...document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")]
    .filter((elShelf): elShelf is PolymerElement =>
      isPolymerElement(elShelf) && richShelfDataSchema.safeParse(elShelf.data).success);
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
    for (const item of deepArray<InnerTubeRichGridItem>(elShelf.data, "contents")) {
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
  for (const videoId of resolvedByVideoId.keys()) {
    if (!presentVideoIds.has(videoId)) {
      resolvedByVideoId.delete(videoId);
    }
  }
}

// oEmbed resolves a video's uploader handle and whether it still exists. The result is cached - the handle
// never changes - so a Short or absent video is queried at most once per trust window, and the calls are
// capped per poll so a first load of many Shorts spreads over a couple of polls rather than firing dozens
// of requests at once. When the budget is spent, any earlier resolution is reused and the rest wait.
async function resolveChannel(videoId: string, budget: { checks: number }) {
  const remembered = resolvedByVideoId.get(videoId);
  if (remembered && remembered.until > Date.now()) {
    return remembered;
  }

  if (budget.checks >= MAX_RESOLVE_CHECKS_PER_POLL) {
    return remembered ?? null;
  }

  budget.checks++;
  const { handle, isAvailable } = await fetchVideoChannel(videoId);
  const resolved = {
    channelKeys: handle ? [handle] : [],
    isAvailable,
    until: Date.now() + RESOLVED_TRUST_MS
  };
  resolvedByVideoId.set(videoId, resolved);
  return resolved;
}

// A video is removable when it is no longer available (a 404 from oEmbed) or when none of its channels is
// subscribed. A collaborative video survives while ANY collaborator is still subscribed. The lockup
// channels settle regular videos for free; a Short (no lockup channel) or a video absent from this poll is
// resolved through oEmbed. An unresolved or restriction-only result leaves the channels unknown and the
// video available, so it is kept - a valid video is never removed on a transient failure.
async function isRemovable(video: ShelfVideo, subscribedKeys: Set<string>, budget: { checks: number }) {
  let { lockupChannelIds: channelKeys } = video;
  let isAvailable = true;
  if (channelKeys.length === 0 || video.isAbsent) {
    const resolved = await resolveChannel(video.videoId, budget);
    if (!resolved) {
      return false;
    }

    channelKeys = channelKeys.length > 0 ? channelKeys : resolved.channelKeys;
    isAvailable = resolved.isAvailable;
  }

  if (!isAvailable) {
    return true;
  }

  return channelKeys.length > 0 && !channelKeys.some(key => subscribedKeys.has(key));
}

function applyShelfRemovals(removableVideoIds: Set<string>) {
  for (const elShelf of usableShelves()) {
    const contents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
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

  const subscribedKeys = await getSubscribedChannelKeys();
  if (!subscribedKeys || subscribedKeys.size === 0) {
    return;
  }

  const shelfVideos = collectShelfVideos(elShelves, collectApiVideoIds(apiContents));
  forgetDepartedVideos(new Set(shelfVideos.map(video => video.videoId)));

  const budget = { checks: 0 };
  const verdicts = await Promise.all(
    shelfVideos.map(async video => ({
      videoId: video.videoId,
      isRemovable: await isRemovable(video, subscribedKeys, budget)
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
