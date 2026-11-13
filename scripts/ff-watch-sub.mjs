await (async () => {
  async function watchSub(videoId) {
    const res = await fetch(`/watch?v=${videoId}`, { credentials: "include" });
    const html = await res.text();
    const data = html.match(/ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s)?.[1];
    let parsed = null;
    try {
      parsed = JSON.parse(data ?? "{}");
    } catch (error) {
      return {
        videoId,
        parseError: true,
        sizeKB: Math.round(html.length / 1024)
      };
    }
    const entities = [];
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
        let channel = null;
        try {
          channel = (atob(count.subscriptionStateEntity.key).match(/UC[\w-]{22}/) ?? [])[0] ?? null;
        } catch (errorValue) {}
        entities.push({
          channel,
          subscribed: count.subscriptionStateEntity.subscribed
        });
      }

      for (const keyValue in count) {
        walk(count[keyValue]);
      }
    })(parsed);
    return {
      videoId,
      httpOk: res.ok,
      sizeKB: Math.round(html.length / 1024),
      dataFound: !!data,
      entityCount: entities.length,
      entities: entities.slice(0, 6)
    };
  }
  return {
    grizzy_expectTrue: await watchSub("_rTtgK2YKSs"),
    collab_expectFalse: await watchSub("iRgin1tWIT8")
  };
})();
