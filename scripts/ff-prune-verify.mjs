await (async () => {
  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const chText = await (await fetch("/feed/channels", { credentials: "include" })).text();
  const data = chText.match(INITIAL_DATA)?.[1] ?? "";
  const keys = new Set();
  for (const message of data.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g)) {
    keys.add(message[1]);
  }
  for (const messageValue of data.matchAll(/"canonicalBaseUrl":"\/(@[\w.-]+)"/g)) {
    keys.add(messageValue[1].toLowerCase());
  }

  const HANDLE = /\/(@[\w.-]+)$/;
  async function fetchVideoChannel(videoId) {
    const result = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    ).catch(() => null);
    if (result?.status === 404) {
      return {
        handle: null,
        isAvailable: false
      };
    }

    const j = result?.ok ? await result.json().catch(() => null) : null;
    return {
      handle: j?.author_url?.match(HANDLE)?.[1]?.toLowerCase() ?? null,
      isAvailable: true
    };
  }
  async function isRemovable(video, subscribedKeys, budget) {
    let channelKeys = video.lockupChannelIds;
    let isAvailable = true;
    if (channelKeys.length === 0 || video.isAbsent) {
      if (budget.checks >= 16) {
        return false;
      }

      budget.checks++;
      const res = await fetchVideoChannel(video.videoId);
      channelKeys = channelKeys.length > 0 ? channelKeys : res.handle ? [res.handle] : [];
      isAvailable = res.isAvailable;
    }

    if (!isAvailable) {
      return true;
    }

    return channelKeys.length > 0 && !channelKeys.some(key => subscribedKeys.has(key));
  }

  const CHANNEL_BROWSE_ID = /"browseEndpoint":\{"browseId":"(UC[\w-]{22})"/g;
  const grid = document.querySelector("ytd-rich-grid-renderer");
  const apiIds = new Set();
  const videos = [];
  for (const item of grid?.data?.contents ?? []) {
    const shelf = item?.richSectionRenderer?.content?.richShelfRenderer;
    const title = shelf?.title?.runs?.[0]?.text;
    if (!title) {
      continue;
    }

    for (const sub of (shelf.contents ?? []).slice(0, 8)) {
      const lvm = sub?.richItemRenderer?.content?.lockupViewModel;
      const shorts = sub?.richItemRenderer?.content?.shortsLockupViewModel;
      const vid = lvm?.contentId ?? shorts?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
      if (!vid) {
        continue;
      }

      apiIds.add(vid);
      videos.push({
        videoId: vid,
        shelf: title,
        kind: lvm ? "regular" : "short",
        lockupChannelIds: lvm
          ? [
              ...new Set(
                [...JSON.stringify(lvm).matchAll(CHANNEL_BROWSE_ID)].map(messageValueValue => messageValueValue[1])
              )
            ]
          : [],
        isAbsent: false
      });
    }
  }

  // steady state: nothing removable
  const budget = { checks: 0 };
  const steady = await Promise.all(
    videos.map(async value => ({
      id: value.videoId,
      shelf: value.shelf,
      kind: value.kind,
      removable: await isRemovable(value, keys, budget)
    }))
  );

  // resolve a real short handle so we can simulate unsubscribing it
  const firstShort = videos.find(valueValue => valueValue.kind === "short");
  const resolvedHandle = firstShort ? (await fetchVideoChannel(firstShort.videoId)).handle : null;
  const simKeys = new Set([...keys].filter(keyValue => keyValue !== resolvedHandle));
  const budget2 = { checks: 0 };
  const removalCases = [];
  if (firstShort) {
    removalCases.push({
      label: `short ${firstShort.videoId} (${resolvedHandle}) unsubscribed`,
      removable: await isRemovable(firstShort, simKeys, budget2),
      expect: true
    });
  }

  removalCases.push({
    label: "deleted id (404)",
    removable: await isRemovable(
      {
        videoId: "ZZprobeZZ00",
        lockupChannelIds: [],
        isAbsent: true
      },
      keys,
      budget2
    ),
    expect: true
  });

  return {
    subscribedKeyCount: keys.size,
    videosChecked: videos.length,
    steadyStateRemovableCount: steady.filter(textValue => textValue.removable).length,
    steadyDetail: steady,
    resolveChecksUsed: budget.checks,
    removalCases,
    removalAllPass: removalCases.every(char => char.removable === char.expect)
  };
})();
