import type { Prettify } from "../../types/prettify";
import { getAvatarImage, hasSameThumbnail, LockupPair, mergeContentImagePreservingThumbnail } from "./lockup-merge";

export { mutateLockupMetadata } from "./lockup-mutate";

// mergeLockupViewModel preserves already-loaded image bytes (so the <img> doesn't refetch when the
// URL changes but the picture is the same), and restores the channel avatar when the incoming
// payload omits it.

function buildPreservedAvatarMetadata({ existing, incoming }: Prettify<LockupPair>) {
  const existingAvatarImage = getAvatarImage(existing);
  const incomingLockupMeta = incoming.metadata?.lockupMetadataViewModel;
  const isLockupMetadataPresent = incomingLockupMeta !== undefined || existingAvatarImage !== undefined;
  if (!isLockupMetadataPresent) {
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
