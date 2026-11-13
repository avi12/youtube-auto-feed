import { z } from "@/shared/zod";
import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "@/subscription-feed/types/innertube";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { isVideoRenderer } from "@/subscription-feed/youtube-api/guards";
import { thumbnailSchema } from "@/subscription-feed/youtube-api/schemas";

const rendererThumbnailSchema = z.looseObject({ thumbnails: z.array(thumbnailSchema) });

function isRendererThumbnail(value: unknown): value is InnerTubeVideoRenderer["thumbnail"] {
  return rendererThumbnailSchema.safeParse(value).success;
}

type BuildMergedVideoRendererParams = Prettify<{
  existing: Prettify<InnerTubeVideoRenderer> | Record<string, unknown> | null;
  incoming: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
  forcePreserveContentImage: boolean;
}>;

export function buildMergedVideoRenderer({
  existing,
  incoming,
  forcePreserveContentImage
}: BuildMergedVideoRendererParams) {
  const isMergeable = forcePreserveContentImage && existing !== null && isVideoRenderer(incoming);
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
