await (async () => {
  const elShelf = [...document.querySelectorAll("ytd-rich-shelf-renderer")].find(
    textValue => textValue.data?.title?.runs?.[0]?.text === "Shorts"
  );
  if (!elShelf) {
    return { error: "no shorts shelf" };
  }

  const idOf = item =>
    item?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ??
    item?.richItemRenderer?.content?.lockupViewModel?.contentId ??
    null;
  const contents = elShelf.data.contents ?? [];
  const before = contents.map(idOf);
  // target a VISIBLE rendered short tile
  const tiles = [...elShelf.querySelectorAll("ytd-rich-item-renderer")].filter(time => time.offsetWidth > 0);
  const targetId =
    tiles.length > 1
      ? (tiles[1].data?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ??
        before.find(Boolean))
      : before.find(Boolean);
  if (!targetId) {
    return {
      error: "no target",
      before
    };
  }

  const retained = contents.filter(item => idOf(item) !== targetId);
  elShelf.set("data.contents", retained);
  await new Promise(result => requestAnimationFrame(() => requestAnimationFrame(result)));

  const afterTiles = [...elShelf.querySelectorAll("ytd-rich-item-renderer")].map(
    timeValue =>
      timeValue.data?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ??
      timeValue.data?.content?.lockupViewModel?.contentId ??
      null
  );
  return {
    targetId,
    beforeCount: before.length,
    afterDataCount: elShelf.data.contents.length,
    targetStillInData: elShelf.data.contents.map(idOf).includes(targetId),
    targetTileStillRendered: afterTiles.includes(targetId),
    setRemovalWorked: !elShelf.data.contents.map(idOf).includes(targetId) && !afterTiles.includes(targetId)
  };
})();
