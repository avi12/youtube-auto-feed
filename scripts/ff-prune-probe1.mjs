await (async () => {
  const grid = document.querySelector("ytd-rich-grid-renderer");
  if (!grid?.data) {
    return { error: "no grid" };
  }

  const contents = grid.data.contents ?? [];
  const bands = [];
  let currentSection = "";
  let currentInlineIds = null;
  function idOf(i) {
    return (
      i?.richItemRenderer?.content?.videoRenderer?.videoId ??
      i?.richItemRenderer?.content?.lockupViewModel?.contentId ??
      i?.richItemRenderer?.content?.lockupViewModel?.videoId ??
      i?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
    );
  }
  for (const item of contents) {
    const inlineId = idOf(item);
    if (inlineId) {
      if (!currentInlineIds) {
        currentInlineIds = [];
        bands.push({
          section: currentSection || "(Latest)",
          ids: currentInlineIds
        });
      }

      currentInlineIds.push(inlineId);
      continue;
    }

    currentInlineIds = null;
    const shelf = item?.richSectionRenderer?.content?.richShelfRenderer;
    const shelfTitle = shelf?.title?.runs?.[0]?.text;
    if (shelfTitle) {
      bands.push({
        section: shelfTitle,
        ids: (shelf.contents ?? []).map(idOf).filter(Boolean)
      });
      currentSection = shelfTitle;
      continue;
    }

    const titleOnly = item?.richSectionRenderer?.content?.shelfRenderer?.title?.runs?.[0]?.text;
    if (titleOnly) {
      currentSection = titleOnly;
    }
  }
  const resources = performance.getEntriesByType("resource").map(errorValue => errorValue.name);
  return {
    bands: bands.map(buffer => ({
      section: buffer.section,
      count: buffer.ids.length,
      ids: buffer.ids
    })),
    oembedCalls: resources.filter(countValue => countValue.includes("/oembed")).length,
    channelsFetches: resources.filter(countValueValue => countValueValue.includes("/feed/channels")).length,
    shelfElCount: document.querySelectorAll("ytd-rich-shelf-renderer").length
  };
})();
