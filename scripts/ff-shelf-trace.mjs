await (async () => {
  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const chText = await (await fetch("/feed/channels", { credentials: "include" })).text();
  const data = chText.match(INITIAL_DATA)?.[1] ?? "";
  const freshSet = new Set();
  for (const m of data.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g)) freshSet.add(m[1]);
  for (const m of data.matchAll(/"canonicalBaseUrl":"\/(@[\w.-]+)"/g)) freshSet.add(m[1].toLowerCase());

  const CHANNEL_BROWSE_ID = /"browseEndpoint":\{"browseId":"(UC[\w-]{22})"/g;
  // replicate usableShelves
  const shelves = [...document.querySelectorAll("ytd-rich-shelf-renderer")].map(el => {
    const isPolymer = typeof el.set === "function" && !!el.data;
    const contents = el.data?.contents;
    const title = el.data?.title?.runs?.[0]?.text ?? null;
    const usable = isPolymer && Array.isArray(contents);
    const videos = (Array.isArray(contents) ? contents : []).map(item => {
      const lvm = item?.richItemRenderer?.content?.lockupViewModel;
      const shorts = item?.richItemRenderer?.content?.shortsLockupViewModel;
      const vid = lvm?.contentId ?? shorts?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
      const channels = lvm ? [...new Set([...JSON.stringify(lvm).matchAll(CHANNEL_BROWSE_ID)].map(m => m[1]))] : [];
      const wouldRemove = channels.length > 0 && !channels.some(c => freshSet.has(c));
      return { vid, kind: lvm ? "regular" : shorts ? "short" : "?", channels, wouldRemove };
    });
    return { title, isPolymer, usable, expanded: el.hasAttribute("is-expanded") || el.getAttribute("is-expanded") !== null, contentsLen: Array.isArray(contents) ? contents.length : null, wouldRemove: videos.filter(v => v.wouldRemove) };
  });

  return {
    freshSetUcCount: [...freshSet].filter(k => k.startsWith("UC")).length,
    shelves
  };
})()
