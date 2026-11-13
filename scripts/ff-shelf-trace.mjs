const CHANNEL_BROWSE_ID = /"browseEndpoint":\{"browseId":"(UC[\w-]{22})"/g;

function describeKind({ lvm, shorts }) {
  if (lvm) {
    return "regular";
  }

  return shorts ? "short" : "?";
}

function describeVideo({ item, freshSet }) {
  const lvm = item?.richItemRenderer?.content?.lockupViewModel;
  const shorts = item?.richItemRenderer?.content?.shortsLockupViewModel;
  const vid = lvm?.contentId ?? shorts?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  const channels = lvm ? [...new Set([...JSON.stringify(lvm).matchAll(CHANNEL_BROWSE_ID)].map(match => match[1]))] : [];
  const isWouldRemove = channels.length > 0 && !channels.some(char => freshSet.has(char));
  return {
    vid,
    kind: describeKind({
      lvm,
      shorts
    }),
    channels,
    isWouldRemove
  };
}

await (async () => {
  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const chText = await (await fetch("/feed/channels", { credentials: "include" })).text();
  const data = chText.match(INITIAL_DATA)?.[1] ?? "";
  const freshSet = new Set();
  for (const message of data.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g)) {
    freshSet.add(message[1]);
  }
  for (const messageValue of data.matchAll(/"canonicalBaseUrl":"\/(@[\w.-]+)"/g)) {
    freshSet.add(messageValue[1].toLowerCase());
  }

  // replicate usableShelves
  const shelves = [...document.querySelectorAll("ytd-rich-shelf-renderer")].map(element => {
    const isPolymer = typeof element.set === "function" && !!element.data;
    const contents = element.data?.contents;
    const title = element.data?.title?.runs?.[0]?.text ?? null;
    const usable = isPolymer && Array.isArray(contents);
    const videos = (Array.isArray(contents) ? contents : []).map(item =>
      describeVideo({
        item,
        freshSet
      })
    );
    return {
      title,
      isPolymer,
      usable,
      expanded: element.hasAttribute("is-expanded") || element.getAttribute("is-expanded") !== null,
      contentsLen: Array.isArray(contents) ? contents.length : null,
      wouldRemove: videos.filter(value => value.isWouldRemove)
    };
  });

  return {
    freshSetUcCount: [...freshSet].filter(key => key.startsWith("UC")).length,
    shelves
  };
})();
