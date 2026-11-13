await (async () => {
  async function watchSub(videoId) {
    const res = await fetch(`/watch?v=${videoId}`, { credentials: "include" });
    const html = await res.text();
    const data = html.match(/ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s)?.[1];
    let parsed = null; try { parsed = JSON.parse(data ?? "{}"); } catch (e) { return { videoId, parseError: true, sizeKB: Math.round(html.length / 1024) }; }
    const entities = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const x of n) walk(x); return; }
      if (n.subscriptionStateEntity) {
        let channel = null;
        try { channel = (atob(n.subscriptionStateEntity.key).match(/UC[\w-]{22}/) ?? [])[0] ?? null; } catch (e) {}
        entities.push({ channel, subscribed: n.subscriptionStateEntity.subscribed });
      }
      for (const k in n) walk(n[k]);
    })(parsed);
    return { videoId, httpOk: res.ok, sizeKB: Math.round(html.length / 1024), dataFound: !!data, entityCount: entities.length, entities: entities.slice(0, 6) };
  }
  return {
    grizzy_expectTrue: await watchSub("_rTtgK2YKSs"),
    collab_expectFalse: await watchSub("iRgin1tWIT8")
  };
})()
