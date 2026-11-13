await (async () => {
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const s = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!s) return null;
    const t = Math.floor(Date.now() / 1000);
    const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${t} ${s} ${YOUTUBE_ORIGIN}`));
    return `SAPISIDHASH ${t}_${[...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
  }
  async function call(endpoint, payload) {
    const k = ytcfg.get("INNERTUBE_API_KEY"), c = ytcfg.get("INNERTUBE_CONTEXT");
    const a = await sapisidHashHeader();
    const h = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": c.client.clientVersion };
    if (a) { h.Authorization = a; h["X-Origin"] = YOUTUBE_ORIGIN; }
    const r = await fetch(`/youtubei/v1/${endpoint}?key=${k}&prettyPrint=false`, { method: "POST", credentials: "include", headers: h, body: JSON.stringify({ context: c, ...payload }) }).catch(() => null);
    return r?.ok ? r.json().catch(() => null) : null;
  }

  const guide = await call("guide", {});
  if (!guide) return { error: "guide null" };

  let countEntry = 0, countCollapsible = 0, expanderItems = 0, sectionTitle = null;
  let collapsibleHasContinuation = false, formResponseToken = null;
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.guideSubscriptionsSectionRenderer) sectionTitle = "found-subscriptions-section";
    if (n.guideEntryRenderer) countEntry++;
    if (n.guideCollapsibleEntryRenderer) {
      countCollapsible++;
      const exp = n.guideCollapsibleEntryRenderer.expandableItems;
      if (Array.isArray(exp)) expanderItems += exp.length;
      const tok = JSON.stringify(n.guideCollapsibleEntryRenderer).match(/"token":"([^"]+)"/);
      if (tok) { collapsibleHasContinuation = true; formResponseToken = tok[1]; }
    }
    for (const k in n) walk(n[k]);
  })(guide);

  const guideText = JSON.stringify(guide);
  const allBrowseUc = new Set([...guideText.matchAll(/"browseId":"(UC[\w-]{22})"/g)].map(m => m[1]));

  // if there is a collapsible continuation, follow it
  let afterContinuation = null;
  if (formResponseToken) {
    const more = await call("guide", { continuation: formResponseToken }) ?? await call("browse", { continuation: formResponseToken });
    if (more) {
      const moreUc = new Set([...JSON.stringify(more).matchAll(/"browseId":"(UC[\w-]{22})"/g)].map(m => m[1]));
      afterContinuation = { newUc: [...moreUc].filter(id => !allBrowseUc.has(id)).length, totalUc: moreUc.size };
    } else afterContinuation = "null";
  }

  return {
    guideEntryRenderers: countEntry,
    collapsibleRenderers: countCollapsible,
    expandableItemsInline: expanderItems,
    distinctBrowseUcInGuide: allBrowseUc.size,
    collapsibleHasContinuation,
    afterContinuation
  };
})()
