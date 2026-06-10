import { innertubePost } from "./innertube-auth";

// The user's subscribed channels, read from the All-subscriptions page's ytInitialData. The InnerTube
// FEchannels browse returns an empty shell, so the page's own embedded data is the source; the first
// page already carries every channel for typical accounts, and a continuation token covers accounts with
// more than one page of subscriptions.
//
// Each channel is stored under BOTH its channel id (UC...) and its @handle, because the two callers
// identify a channel differently: a regular video's lockup carries the channel id, while a Short is
// resolved through oEmbed which only yields the handle. Holding both in one set lets either be tested
// with a single membership check.
//
// The set is cached: the shelf prune runs every 5s poll, but subscriptions change only when the user
// actually (un)subscribes, so re-downloading the whole channels page each poll would be wasteful. The
// cost is staleness - an unsubscribe is reflected only after the cache expires. A fetch failure keeps the
// last good set so a network hiccup never empties the shelves.

const SUBSCRIPTIONS_TTL_MS = 5 * 60 * 1000;
const SUBSCRIPTION_RECHECK_WINDOW_MS = 30 * 1000;
const CONTINUATION_PAGE_CAP = 8;
const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
const CHANNEL_RENDERER_ID = /"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g;
const CHANNEL_HANDLE = /"canonicalBaseUrl":"\/(@[\w.-]+)"/g;
const CONTINUATION_TOKEN = /"continuationCommand":\{"token":"([^"]+)"/;

let cache: {
  channelKeys: Set<string>;
  fetchedAt: number;
} | null = null;
let recheckUntil = 0;

function readChannelKeys(text: string, into: Set<string>) {
  for (const match of text.matchAll(CHANNEL_RENDERER_ID)) {
    into.add(match[1]);
  }

  for (const match of text.matchAll(CHANNEL_HANDLE)) {
    into.add(match[1].toLowerCase());
  }
  return into.size;
}

async function fetchSubscribedChannelKeys() {
  const response = await fetch("/feed/channels", { credentials: "include" }).catch(() => null);
  const initialData = response?.ok ? (await response.text().catch(() => "")).match(INITIAL_DATA)?.[1] : undefined;
  if (!initialData) {
    return null;
  }

  const channelKeys = new Set<string>();
  readChannelKeys(initialData, channelKeys);
  let token = initialData.match(CONTINUATION_TOKEN)?.[1];
  for (let page = 0; token && page < CONTINUATION_PAGE_CAP; page++) {
    const continuation = await innertubePost("browse", { continuation: token });
    if (!continuation) {
      break;
    }

    const before = channelKeys.size;
    const text = JSON.stringify(continuation);
    readChannelKeys(text, channelKeys);
    const next = text.match(CONTINUATION_TOKEN)?.[1];
    token = next && next !== token && channelKeys.size > before ? next : undefined;
  }
  return channelKeys;
}

// A (un)subscribe was just signalled. The channels page can keep serving the pre-change list for a few
// seconds, so a single refetch right after would re-cache the stale set for the whole TTL. Open a short
// window in which every poll refetches and the cache settles only once the set actually differs.
export function invalidateSubscribedChannelKeys() {
  recheckUntil = Date.now() + SUBSCRIPTION_RECHECK_WINDOW_MS;
}

function isSameKeySet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every(key => right.has(key));
}

export async function getSubscribedChannelKeys() {
  const isRechecking = Date.now() < recheckUntil;
  if (cache && !isRechecking && Date.now() - cache.fetchedAt < SUBSCRIPTIONS_TTL_MS) {
    return cache.channelKeys;
  }

  const channelKeys = await fetchSubscribedChannelKeys();
  if (!channelKeys || channelKeys.size === 0) {
    return cache?.channelKeys ?? null;
  }

  const isStillStale = isRechecking && !!cache && isSameKeySet(channelKeys, cache.channelKeys);
  if (!isStillStale) {
    recheckUntil = 0;
  }

  cache = {
    channelKeys,
    fetchedAt: Date.now()
  };
  return channelKeys;
}
