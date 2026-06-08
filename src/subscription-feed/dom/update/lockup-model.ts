import { z } from "../../../shared/zod";
import type { InnerTubeRichGridItem, LockupViewModel } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray } from "../../utils/records";
import { isLockupViewModel } from "../../youtube-api/guards";
import { gridDataSchema, richItemContentSchema, richShelfDataSchema } from "../../youtube-api/schemas";
import { findRichItemIndex } from "../rich-item";

// Merges an incoming lockupViewModel into the existing one, preserving already-loaded image bytes
// (so the <img> doesn't refetch when the URL changes but the picture is the same), and restoring the
// channel avatar when the incoming payload omits it. mutateLockupMetadata walks every location where
// the lockup lives: the element's data, the grid's data.contents, and every rich shelf's contents.

// Full URL including sqp/rs query as the thumbnail identity key. The query - not the path - changes
// when a creator swaps the thumbnail; a path-only key would treat the new image as identical and
// keep grafting the stale bytes.
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

function mergeContentImagePreservingThumbnail({ existing, incoming }: MergeContentImagePreservingThumbnailParams): LockupViewModel["contentImage"] {
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

  // Only graft the loaded bytes when it is the same picture (same URL key). If the keys differ the
  // existing image belongs to a different video; keeping it would pair the new video's id with the
  // previous occupant's thumbnail - the "wrong thumbnail" corruption.
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

type MutateLockupInContainerParams = Prettify<{
  containerData: unknown;
  videoId: string;
  mutateOne: (candidate: unknown) => void;
}>;

function mutateLockupInContainer({ containerData, videoId, mutateOne }: MutateLockupInContainerParams) {
  const contents = deepArray<InnerTubeRichGridItem>(containerData, "contents");
  const iItem = findRichItemIndex({
    contents,
    videoId
  });
  if (iItem < 0) {
    return;
  }

  const content = contents[iItem]?.richItemRenderer?.content;
  if (content) {
    mutateOne(content.lockupViewModel);
  }
}

const itemDataSchema = z.looseObject({
  content: richItemContentSchema.optional().catch(undefined)
});

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

  const itemDataParse = itemDataSchema.safeParse(elItem.data);
  if (itemDataParse.success) {
    mutateOne(itemDataParse.data.content?.lockupViewModel);
  }

  for (const elGrid of document.querySelectorAll<HTMLElement>("ytd-rich-grid-renderer")) {
    const isGridUsable = isPolymerElement(elGrid) && gridDataSchema.safeParse(elGrid.data).success;
    if (!isGridUsable) {
      continue;
    }

    mutateLockupInContainer({
      containerData: elGrid.data,
      videoId,
      mutateOne
    });
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    const isShelfUsable = isPolymerElement(elShelf) && richShelfDataSchema.safeParse(elShelf.data).success;
    if (!isShelfUsable) {
      continue;
    }

    mutateLockupInContainer({
      containerData: elShelf.data,
      videoId,
      mutateOne
    });
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
