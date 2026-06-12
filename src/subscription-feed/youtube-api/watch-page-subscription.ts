// The viewer's real subscription state for a video's channel - and for every collaborator on a
// collab video - lives in the watch page HTML as subscriptionStateEntity records, each keyed by a
// base64 entity key whose decoded bytes embed the channelId. This is the only reliable source: the
// channels feed truncates past ~100 subscriptions and the InnerTube JSON endpoints under-report the
// subscription from this context. A collab video belongs in the feed while ANY collaborator is
// subscribed, so the whole channel map is read, not just the owner. Verdicts are cached per channel
// (subscription changes only when the user (un)subscribes) and the large watch pages are capped per
// poll, so a first load spreads its probes over a couple of polls instead of fetching dozens at once.

const SUBSCRIPTION_TRUST_MS = 30 * 60 * 1000;
const MAX_WATCH_PAGE_CHECKS_PER_POLL = 8;
const CHANNEL_ID = /UC[\w-]{22}/;
const OWNER_CHANNEL = /"videoDetails":\{[\s\S]{0,1500}?"channelId":"(UC[\w-]{22})"/;
const SUBSCRIPTION_ENTITY = /"subscriptionStateEntity":\{"key":"([^"]+)","subscribed":(true|false)\}/g;

export enum SubscriptionVerdict {
  Subscribed = "subscribed",
  Unsubscribed = "unsubscribed",
  Unknown = "unknown"
}

interface CachedSubscription {
  isSubscribed: boolean;
  until: number;
}

const subscriptionByChannelId = new Map<string, CachedSubscription>();
const ownerChannelByVideoId = new Map<string, string>();

export function invalidateSubscriptionCache() {
  subscriptionByChannelId.clear();
  ownerChannelByVideoId.clear();
}

function decodeEntityChannelId(key: string) {
  try {
    return atob(key.replaceAll(/-/g, "+").replaceAll(/_/g, "/")).match(CHANNEL_ID)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchWatchPageSubscriptions(videoId: string) {
  const response = await fetch(`/watch?v=${videoId}`, { credentials: "include" }).catch(() => null);
  const html = response?.ok ? await response.text().catch(() => null) : null;
  if (!html) {
    return null;
  }

  const channelSubscriptions = new Map<string, boolean>();
  for (const [, key, subscribed] of html.matchAll(SUBSCRIPTION_ENTITY)) {
    const channelId = decodeEntityChannelId(key);
    if (channelId) {
      channelSubscriptions.set(channelId, subscribed === "true");
    }
  }
  return {
    channelSubscriptions,
    ownerChannelId: html.match(OWNER_CHANNEL)?.[1] ?? null
  };
}

function rememberSubscriptions(channelSubscriptions: Map<string, boolean>) {
  const until = Date.now() + SUBSCRIPTION_TRUST_MS;
  for (const [channelId, isSubscribed] of channelSubscriptions) {
    subscriptionByChannelId.set(channelId, {
      isSubscribed,
      until
    });
  }
}

function verdictFrom(channelIds: string[], lookup: (channelId: string) => boolean | undefined): SubscriptionVerdict {
  if (channelIds.length === 0) {
    return SubscriptionVerdict.Unknown;
  }

  const states = channelIds.map(lookup);
  if (states.includes(true)) {
    return SubscriptionVerdict.Subscribed;
  }

  if (!states.includes(undefined)) {
    return SubscriptionVerdict.Unsubscribed;
  }

  return SubscriptionVerdict.Unknown;
}

function resolveDecisionIds(lockupChannelIds: string[], ownerChannelId: string | null) {
  if (lockupChannelIds.length > 0) {
    return lockupChannelIds;
  }

  if (ownerChannelId) {
    return [ownerChannelId];
  }

  return [];
}

function cachedSubscription(channelId: string) {
  const entry = subscriptionByChannelId.get(channelId);
  return entry && entry.until > Date.now() ? entry.isSubscribed : undefined;
}

// A collab video carries every collaborator's channel id in its lockup; a Short carries none, so its
// owner channel is taken from the probed watch page instead and remembered by video id - otherwise a
// channel-less Short would miss the per-channel cache and re-fetch its heavy watch page every poll,
// which YouTube flags as abuse and soft-blocks the video for the session. The video is kept while any
// of those channels is subscribed, and removed only when all of them are known and none is.
export async function resolveChannelSubscription(
  lockupChannelIds: string[],
  videoId: string,
  budget: { watchPageChecks: number }
): Promise<SubscriptionVerdict> {
  const knownChannelIds = resolveDecisionIds(lockupChannelIds, ownerChannelByVideoId.get(videoId) ?? null);
  const cached = verdictFrom(knownChannelIds, cachedSubscription);
  if (cached !== SubscriptionVerdict.Unknown) {
    return cached;
  }

  if (budget.watchPageChecks >= MAX_WATCH_PAGE_CHECKS_PER_POLL) {
    return SubscriptionVerdict.Unknown;
  }

  budget.watchPageChecks++;
  const probe = await fetchWatchPageSubscriptions(videoId);
  if (!probe) {
    return SubscriptionVerdict.Unknown;
  }

  rememberSubscriptions(probe.channelSubscriptions);

  if (probe.ownerChannelId) {
    ownerChannelByVideoId.set(videoId, probe.ownerChannelId);
  }

  const decisionIds = resolveDecisionIds(lockupChannelIds, probe.ownerChannelId);
  return verdictFrom(decisionIds, channelId => probe.channelSubscriptions.get(channelId));
}
