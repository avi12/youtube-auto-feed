(() =>
  [...document.querySelectorAll("ytd-rich-shelf-renderer")].map(elShelf => {
    const title = elShelf.data?.title?.runs?.[0]?.text ?? "?";
    const elContents = elShelf.querySelector("#contents");
    const richItems = elShelf.querySelectorAll("ytd-rich-item-renderer");
    const firstItem = richItems[0] ?? null;
    const dataContents = Array.isArray(elShelf.data?.contents) ? elShelf.data.contents : null;
    // what element actually wraps the tiles?
    const itemParent = firstItem?.parentElement;
    return {
      title,
      isExpanded: elShelf.hasAttribute("is-expanded"),
      hasHashContents: !!elContents,
      contentsId: elContents?.id ?? null,
      richItemRendererCount: richItems.length,
      dataContentsLen: dataContents?.length ?? null,
      itemParentTag: itemParent ? itemParent.tagName.toLowerCase() + (itemParent.id ? "#" + itemParent.id : "") : null,
      firstItemTag: firstItem?.tagName.toLowerCase() ?? null,
      firstItemOffsetW: firstItem?.offsetWidth ?? null,
      // does #contents contain the rich items, or are they elsewhere?
      itemsInsideHashContents: elContents ? elContents.querySelectorAll("ytd-rich-item-renderer").length : null
    };
  }))();
