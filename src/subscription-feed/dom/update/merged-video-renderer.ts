import { z } from "@/shared/zod";
import { createGuard } from "@/shared/zod-guard";
import type {
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "@/subscription-feed/types/innertube";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { isVideoRenderer } from "@/subscription-feed/youtube-api/guards";
import { thumbnailSchema } from "@/subscription-feed/youtube-api/schemas";

const isRendererThumbnail = createGuard(z.looseObject({ thumbnails: z.array(thumbnailSchema) }));

type BuildMergedVideoRendererParams = Prettify<{
  existing: Prettify<InnerTubeVideoRenderer> | Record<string, unknown> | null;
  incoming: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  isContentImagePreserveForced: boolean;
}>;

export function buildMergedVideoRenderer({
  existing,
  incoming,
  isContentImagePreserveForced
}: BuildMergedVideoRendererParams) {
  const isMergeable = isContentImagePreserveForced && existing !== null && isVideoRenderer(incoming);
  if (!isMergeable) {
    return incoming;
  }

  const { thumbnail } = existing;
  if (!isRendererThumbnail(thumbnail)) {
    return incoming;
  }

  // Keep the existing thumbnail so the in-flight <img> retains its decoded bytes.
  return {
    ...incoming,
    thumbnail
  };
}
