await (async () => {
  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const raw = await (await fetch("/feed/channels", { credentials: "include" })).text();
  const initial = raw.match(INITIAL_DATA)?.[1] ?? "";
  const ffChannels = [
    ...new Set([...initial.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g)].map(message => message[1]))
  ];

  // first feed video + its channel (from the live grid)
  const grid = document.querySelector("ytd-rich-grid-renderer");
  let firstVideoId = null,
    firstChannel = null,
    firstKind = null;
  const CHANNEL_BROWSE_ID = /"browseEndpoint":\{"browseId":"(UC[\w-]{22})"/;
  for (const item of grid?.data?.contents ?? []) {
    const lvm = item?.richItemRenderer?.content?.lockupViewModel;
    if (lvm) {
      firstVideoId = lvm.contentId;
      firstKind = "inline-regular";
      firstChannel = (JSON.stringify(lvm).match(CHANNEL_BROWSE_ID) ?? [])[1] ?? null;
      break;
    }
  }

  // watch-page subscribe state for the first feed video
  let watch = null;
  if (firstVideoId) {
    const html = await (await fetch(`/watch?v=${firstVideoId}`, { credentials: "include" })).text();
    const data = html.match(INITIAL_DATA)?.[1];
    let parsed = null;
    try {
      parsed = JSON.parse(data ?? "{}");
    } catch (error) {}
    const entities = [];
    if (parsed) {
      (function walk(count) {
        if (!count || typeof count !== "object") {
          return;
        }
        if (Array.isArray(count)) {
          for (const x of count) {
            walk(x);
          }
          return;
        }

        if (count.subscriptionStateEntity) {
          let char = null;
          try {
            char = (atob(count.subscriptionStateEntity.key).match(/UC[\w-]{22}/) ?? [])[0] ?? null;
          } catch (errorValue) {}
          entities.push({
            channel: char,
            subscribed: count.subscriptionStateEntity.subscribed
          });
        }

        for (const keyValue in count) {
          walk(count[keyValue]);
        }
      })(parsed);
    }

    watch = {
      sizeKB: Math.round(html.length / 1024),
      entities,
      ownerEntity: entities.find(errorValueValue => errorValueValue.channel === firstChannel) ?? null
    };
  }

  return {
    ffChannelCount: ffChannels.length,
    ffChannelsSample: ffChannels.slice(0, 12),
    loggedIn: typeof ytcfg !== "undefined" ? ytcfg.get("LOGGED_IN") : null,
    dataSyncId: typeof ytcfg !== "undefined" ? ytcfg.get("DATASYNC_ID") : null,
    firstVideoId,
    firstKind,
    firstChannel,
    firstChannelInFfSet: firstChannel ? ffChannels.includes(firstChannel) : null,
    watch
  };
})();
