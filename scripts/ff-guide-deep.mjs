await (async () => {
  const HEX_RADIX = 16;
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const text = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!text) {
      return null;
    }

    const time = Math.floor(Date.now() / 1000);
    const data = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${time} ${text} ${YOUTUBE_ORIGIN}`));
    return `SAPISIDHASH ${time}_${[...new Uint8Array(data)].map(buffer => buffer.toString(HEX_RADIX).padStart(2, "0")).join("")}`;
  }
  async function call({ endpoint, payload }) {
    const key = ytcfg.get("INNERTUBE_API_KEY"),
      char = ytcfg.get("INNERTUBE_CONTEXT");
    const first = await sapisidHashHeader();
    const handler = {
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": char.client.clientVersion
    };
    if (first) {
      handler.Authorization = first;
      handler["X-Origin"] = YOUTUBE_ORIGIN;
    }

    const result = await fetch(`/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: handler,
      body: JSON.stringify({
        context: char,
        ...payload
      })
    }).catch(() => null);
    return result?.ok ? result.json().catch(() => null) : null;
  }

  const guide = await call({
    endpoint: "guide",
    payload: {}
  });
  if (!guide) {
    return { error: "guide null" };
  }

  let countEntry = 0,
    countCollapsible = 0,
    expanderItems = 0;
  let hasCollapsibleContinuation = false,
    formResponseToken = null;
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

    if (count.guideEntryRenderer) {
      countEntry++;
    }

    if (count.guideCollapsibleEntryRenderer) {
      countCollapsible++;
      const exp = count.guideCollapsibleEntryRenderer.expandableItems;
      if (Array.isArray(exp)) {
        expanderItems += exp.length;
      }

      const tok = JSON.stringify(count.guideCollapsibleEntryRenderer).match(/"token":"([^"]+)"/);
      if (tok) {
        hasCollapsibleContinuation = true;
        formResponseToken = tok[1];
      }
    }

    for (const keyValue of Object.keys(count)) {
      walk(count[keyValue]);
    }
  })(guide);

  const guideText = JSON.stringify(guide);
  const allBrowseUc = new Set([...guideText.matchAll(/"browseId":"(UC[\w-]{22})"/g)].map(message => message[1]));

  // if there is a collapsible continuation, follow it
  let afterContinuation = null;
  if (formResponseToken) {
    const more =
      (await call({
        endpoint: "guide",
        payload: {
          continuation: formResponseToken
        }
      })) ??
      (await call({
        endpoint: "browse",
        payload: {
          continuation: formResponseToken
        }
      }));
    if (more) {
      const moreUc = new Set(
        [...JSON.stringify(more).matchAll(/"browseId":"(UC[\w-]{22})"/g)].map(messageValue => messageValue[1])
      );
      afterContinuation = {
        newUc: [...moreUc].filter(id => !allBrowseUc.has(id)).length,
        totalUc: moreUc.size
      };
    } else {
      afterContinuation = "null";
    }
  }

  return {
    guideEntryRenderers: countEntry,
    collapsibleRenderers: countCollapsible,
    expandableItemsInline: expanderItems,
    distinctBrowseUcInGuide: allBrowseUc.size,
    hasCollapsibleContinuation,
    afterContinuation
  };
})();
