await (async () => {
  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const raw = await (await fetch("/feed/channels", { credentials: "include" })).text();
  const initial = raw.match(INITIAL_DATA)?.[1] ?? "";
  const ffChannels = [...new Set([...initial.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g)].map(m => m[1]))];

  // first feed video + its channel (from the live grid)
  const grid = document.querySelector("ytd-rich-grid-renderer");
  let firstVideoId = null, firstChannel = null, firstKind = null;
  const CHANNEL_BROWSE_ID = /"browseEndpoint":\{"browseId":"(UC[\w-]{22})"/;
  for (const item of grid?.data?.contents ?? []) {
    const lvm = item?.richItemRenderer?.content?.lockupViewModel;
    if (lvm) { firstVideoId = lvm.contentId; firstKind = "inline-regular"; firstChannel = (JSON.stringify(lvm).match(CHANNEL_BROWSE_ID) ?? [])[1] ?? null; break; }
  }

  // watch-page subscribe state for the first feed video
  let watch = null;
  if (firstVideoId) {
    const html = await (await fetch(`/watch?v=${firstVideoId}`, { credentials: "include" })).text();
    const data = html.match(INITIAL_DATA)?.[1];
    let parsed = null; try { parsed = JSON.parse(data ?? "{}"); } catch (e) {}
    const entities = [];
    if (parsed) (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const x of n) walk(x); return; }
      if (n.subscriptionStateEntity) { let c = null; try { c = (atob(n.subscriptionStateEntity.key).match(/UC[\w-]{22}/) ?? [])[0] ?? null; } catch (e) {} entities.push({ channel: c, subscribed: n.subscriptionStateEntity.subscribed }); }
      for (const k in n) walk(n[k]);
    })(parsed);
    watch = { sizeKB: Math.round(html.length / 1024), entities, ownerEntity: entities.find(e => e.channel === firstChannel) ?? null };
  }

  return {
    ffChannelCount: ffChannels.length,
    ffChannelsSample: ffChannels.slice(0, 12),
    loggedIn: (typeof ytcfg !== "undefined") ? ytcfg.get("LOGGED_IN") : null,
    dataSyncId: (typeof ytcfg !== "undefined") ? ytcfg.get("DATASYNC_ID") : null,
    firstVideoId, firstKind, firstChannel,
    firstChannelInFfSet: firstChannel ? ffChannels.includes(firstChannel) : null,
    watch
  };
})()
