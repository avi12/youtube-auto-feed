import type { LockupViewModel } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";

// The full URL (including the sqp/rs query) is the thumbnail identity key. The query, not the path,
// changes when a creator swaps the thumbnail; a path-only key would treat the new image as identical
// and keep grafting the stale bytes.
function getThumbnailUrlKey(contentImage: LockupViewModel["contentImage"]) {
  return contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url;
}

export function getAvatarImage(viewModel: Prettify<LockupViewModel>) {
  return viewModel.metadata?.lockupMetadataViewModel?.image;
}

export interface LockupPair {
  existing: LockupViewModel;
  incoming: LockupViewModel;
}

export function hasSameThumbnail({ existing, incoming }: Prettify<LockupPair>) {
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

  // Graft the loaded bytes only for the same picture. Keys differing means the existing image belongs
  // to a different video; reusing it would pair the new id with the old thumbnail (wrong-thumbnail bug).
  const isSamePicture = getThumbnailUrlKey(existing) === getThumbnailUrlKey(incoming);
  if (!isSamePicture) {
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
