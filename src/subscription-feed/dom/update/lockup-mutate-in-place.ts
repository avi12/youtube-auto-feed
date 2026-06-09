import type { Prettify } from "../../types/prettify";
import { getAvatarImage, LockupPair, mergeContentImagePreservingThumbnail } from "./lockup-merge";

type MutateLockupViewModelInPlaceParams = Prettify<LockupPair & {
  preserveContentImage: boolean;
}>;

export function mutateLockupViewModelInPlace({
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
