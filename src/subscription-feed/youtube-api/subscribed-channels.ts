// The viewer's subscription set, read from the same guide payload YouTube builds its own sidebar from.
// One authenticated call returns every followed channel - inline entries plus everything behind the
// "Show more" expander - as both a channel id and a handle, so a shelf video can be judged locally.
//
// This replaces probing each video's watch page for a subscribed flag. That probe was the only source
// that reported the viewer's own state, but it cost a page-sized fetch per video, YouTube flags the
// resulting traffic as abuse, and on a brand account the watch page resolves the default account and
// reports every channel as unsubscribed. The guide carries the brand account's page id like the feed
// call does, so it answers for the account actually being viewed. The channels feed is not an
// alternative: it truncates past ~100 subscriptions, while the guide list is complete.
//
// The set only changes when the user subscribes or unsubscribes, which the monitor already watches
// for, so it is held for a long trust window and dropped on that signal. A failed call backs off
// rather than retrying every poll, and callers treat a missing set as "keep everything".

import type { InnerTubeGuideResponse } from "../types/innertube";
import { channelHandleFromUrl } from "./channel-handle";
import { isInnerTubeGuideResponse } from "./guards";
import { InnerTubeEndpoint, postInnerTube } from "./innertube-request";

const SUBSCRIPTIONS_TRUST_MS = 30 * 60 * 1000;
const FAILED_FETCH_BACKOFF_MS = 5 * 60 * 1000;

export interface SubscribedChannels {
  channelIds: Set<string>;
  handles: Set<string>;
}

let cachedChannels: SubscribedChannels | null = null;
let cachedUntil = 0;
let retryAfter = 0;
let pendingFetch: Promise<SubscribedChannels | null> | null = null;

export function invalidateSubscriptionCache() {
  cachedChannels = null;
  cachedUntil = 0;
  retryAfter = 0;
}

function channelEntries(response: InnerTubeGuideResponse) {
  const subscriptionsSection = response.items
    ?.find(item => item.guideSubscriptionsSectionRenderer)?.guideSubscriptionsSectionRenderer;
  return (subscriptionsSection?.items ?? []).flatMap(item => [
    item.guideEntryRenderer,
    ...(item.guideCollapsibleEntryRenderer?.expandableItems ?? []).map(expandable => expandable.guideEntryRenderer)
  ]);
}

function toSubscribedChannels(response: InnerTubeGuideResponse) {
  const channelIds = new Set<string>();
  const handles = new Set<string>();
  for (const entry of channelEntries(response)) {
    const { browseId, canonicalBaseUrl } = entry?.navigationEndpoint?.browseEndpoint ?? {};
    if (browseId) {
      channelIds.add(browseId);
    }

    const handle = channelHandleFromUrl(canonicalBaseUrl);
    if (handle) {
      handles.add(handle);
    }
  }
  return {
    channelIds,
    handles
  };
}

async function fetchGuideChannels() {
  const response = await postInnerTube({ endpoint: InnerTubeEndpoint.Guide });
  if (!isInnerTubeGuideResponse(response)) {
    return null;
  }

  const channels = toSubscribedChannels(response);
  return channels.channelIds.size > 0 ? channels : null;
}

async function refreshSubscribedChannels() {
  const channels = await fetchGuideChannels();
  if (!channels) {
    retryAfter = Date.now() + FAILED_FETCH_BACKOFF_MS;
    return null;
  }

  cachedChannels = channels;
  cachedUntil = Date.now() + SUBSCRIPTIONS_TRUST_MS;
  return channels;
}

export async function resolveSubscribedChannels() {
  if (cachedChannels && cachedUntil > Date.now()) {
    return cachedChannels;
  }

  if (retryAfter > Date.now()) {
    return null;
  }

  pendingFetch ??= refreshSubscribedChannels().finally(() => {
    pendingFetch = null;
  });
  return pendingFetch;
}
