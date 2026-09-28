import type { Prettify } from "../../types/prettify";
import { contentImageWithPaintedBadge } from "../new-badge/new-badge";
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

  const mergedContentImage = preserveContentImage
    ? mergeContentImagePreservingThumbnail({
      existing: preservedContentImage,
      incoming: incoming.contentImage
    })
    : existing.contentImage;
  existing.contentImage = contentImageWithPaintedBadge({
    painted: preservedContentImage,
    contentImage: mergedContentImage
  });

  const isAvatarRestoreNeeded = incomingAvatarImage === undefined
    && existingAvatarImage !== undefined
    && existing.metadata?.lockupMetadataViewModel !== undefined;
  if (!isAvatarRestoreNeeded) {
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
