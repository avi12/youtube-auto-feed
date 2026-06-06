import type { InnerTubeRichGridItem, LockupViewModel } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray, isRecord } from "../../utils/records";
import { isLockupViewModel } from "../../youtube-api/guards";
import { findRichItemIndex } from "../rich-item";

// Helpers for merging the *new* lockupViewModel into the *existing* one while preserving
// already-loaded image bytes (so the live <img> doesn't refetch when the URL changes but the
// picture doesn't), and preserving the channel avatar when the incoming payload omits it.
// Lockup metadata lives in multiple places (the element's `data`, the grid's data.contents,
// every rich shelf's contents) so `mutateLockupMetadata` walks all of them.

// Identity of the thumbnail image: the full URL including the sqp/rs query. The query - not the
// path - is what changes when a creator swaps the thumbnail (the /vi/{id}/ path stays the same), so
// a path-only key would treat the new image as identical and keep grafting the stale one.
function getThumbnailUrlKey(contentImage: LockupViewModel["contentImage"]) {
  return contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url;
}

function getAvatarImage(viewModel: Prettify<LockupViewModel>) {
  return viewModel.metadata?.lockupMetadataViewModel?.image;
}

interface LockupPair {
  existing: LockupViewModel;
  incoming: LockupViewModel;
}

function hasSameThumbnail({ existing, incoming }: Prettify<LockupPair>) {
  return getThumbnailUrlKey(existing.contentImage) === getThumbnailUrlKey(incoming.contentImage);
}

type MergeContentImagePreservingThumbnailParams = Prettify<{
  existing: LockupViewModel["contentImage"];
  incoming: LockupViewModel["contentImage"];
}>;

export function mergeContentImagePreservingThumbnail({ existing, incoming }: MergeContentImagePreservingThumbnailParams): LockupViewModel["contentImage"] {
  if (!existing) {
    return incoming;
  }

  if (!incoming) {
    return existing;
  }

  const existingThumb = existing.thumbnailViewModel;
  const incomingThumb = incoming.thumbnailViewModel;
  if (!incomingThumb) {
    return existing;
  }

  if (!existingThumb) {
    return incoming;
  }

  // Only graft the already-loaded bytes when it is the same picture (same URL key, ignoring query
  // params). If the keys differ the existing image belongs to a different video/thumbnail, and
  // keeping it would pair the incoming video's id with the previous occupant's thumbnail and
  // overlays - the off-by-one "wrong thumbnail" corruption. In that case take the incoming image.
  if (getThumbnailUrlKey(existing) !== getThumbnailUrlKey(incoming)) {
    return incoming;
  }

  return {
    ...incoming,
    thumbnailViewModel: {
      ...incomingThumb,
      image: existingThumb.image ?? incomingThumb.image
    }
  };
}

type MutateLockupViewModelInPlaceParams = Prettify<LockupPair & {
  preserveContentImage: boolean;
}>;

function mutateLockupViewModelInPlace({
  existing,
  incoming,
  preserveContentImage
}: MutateLockupViewModelInPlaceParams) {
  const existingAvatarImage = getAvatarImage(existing);
  const incomingAvatarImage = getAvatarImage(incoming);
  const preservedContentImage = existing.contentImage;

  Object.assign(existing, incoming);

  if (preserveContentImage) {
    existing.contentImage = mergeContentImagePreservingThumbnail({
      existing: preservedContentImage,
      incoming: incoming.contentImage
    });
  }

  const shouldRestoreAvatar = incomingAvatarImage === undefined
    && existingAvatarImage !== undefined
    && existing.metadata?.lockupMetadataViewModel !== undefined;
  if (!shouldRestoreAvatar) {
    return;
  }

  existing.metadata = {
    ...existing.metadata,
    lockupMetadataViewModel: {
      ...existing.metadata?.lockupMetadataViewModel,
      image: existingAvatarImage
    }
  };
}

type MutateLockupMetadataParams = Prettify<{
  videoId: string;
  elItem: PolymerElement;
  incoming: Prettify<LockupViewModel>;
  preserveContentImage: boolean;
}>;

export function mutateLockupMetadata({ videoId, elItem, incoming, preserveContentImage }: MutateLockupMetadataParams) {
  const seenLockups = new Set<LockupViewModel>();
  function mutateOne(candidate: unknown) {
    const isReusableLockup = isLockupViewModel(candidate) && !seenLockups.has(candidate);
    if (!isReusableLockup) {
      return;
    }

    seenLockups.add(candidate);
    mutateLockupViewModelInPlace({
      existing: candidate,
      incoming,
      preserveContentImage
    });
  }

  const itemData = elItem.data;
  if (isRecord(itemData) && isRecord(itemData.content)) {
    mutateOne(itemData.content.lockupViewModel);
  }

  for (const elGrid of document.querySelectorAll<HTMLElement>("ytd-rich-grid-renderer")) {
    const isGridUsable = isPolymerElement(elGrid) && isRecord(elGrid.data);
    if (!isGridUsable) {
      continue;
    }

    const contents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
    const iItem = findRichItemIndex({
      contents,
      videoId
    });
    if (iItem < 0) {
      continue;
    }

    const content = contents[iItem]?.richItemRenderer?.content;
    if (content) {
      mutateOne(content.lockupViewModel);
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    const isShelfUsable = isPolymerElement(elShelf) && isRecord(elShelf.data);
    if (!isShelfUsable) {
      continue;
    }

    const contents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
    const iItem = findRichItemIndex({
      contents,
      videoId
    });
    if (iItem < 0) {
      continue;
    }

    const content = contents[iItem]?.richItemRenderer?.content;
    if (content) {
      mutateOne(content.lockupViewModel);
    }
  }
}

function buildPreservedAvatarMetadata({ existing, incoming }: Prettify<LockupPair>) {
  const existingAvatarImage = getAvatarImage(existing);
  const incomingLockupMeta = incoming.metadata?.lockupMetadataViewModel;
  const lacksLockupMetadata = incomingLockupMeta === undefined && existingAvatarImage === undefined;
  if (lacksLockupMetadata) {
    return incoming.metadata;
  }

  return {
    ...incoming.metadata,
    lockupMetadataViewModel: {
      ...incomingLockupMeta,
      image: getAvatarImage(incoming) ?? existingAvatarImage
    }
  };
}

type MergeLockupViewModelParams = Prettify<LockupPair & {
  forcePreserveContentImage?: boolean;
}>;

export function mergeLockupViewModel({
  existing,
  incoming,
  forcePreserveContentImage = false
}: MergeLockupViewModelParams) {
  const shouldPreserveThumbnail = forcePreserveContentImage || hasSameThumbnail({
    existing,
    incoming
  });
  const contentImage = shouldPreserveThumbnail
    ? mergeContentImagePreservingThumbnail({
      existing: existing.contentImage,
      incoming: incoming.contentImage
    })
    : incoming.contentImage;
  return {
    ...incoming,
    contentImage,
    metadata: buildPreservedAvatarMetadata({
      existing,
      incoming
    })
  };
}
