import { z } from "../../shared/zod";
import { isVideoRenderer } from "../youtube-api/guards";
import { richItemContentSchema } from "../youtube-api/schemas";

const nonEmptyStringSchema = z.string().min(1);

const dataSchema = z.looseObject({
  content: richItemContentSchema.optional().catch(undefined)
});

export function videoIdFromData(data: unknown) {
  if (isVideoRenderer(data)) {
    return data.videoId || null;
  }

  const dataParsed = dataSchema.safeParse(data);
  const content = dataParsed.success ? dataParsed.data.content : undefined;
  if (!content) {
    return null;
  }

  if (content.videoRenderer) {
    return content.videoRenderer.videoId || null;
  }

  if (content.gridVideoRenderer) {
    return content.gridVideoRenderer.videoId || null;
  }

  const innerVideoRenderer = content.richGridMediaRenderer?.content?.videoRenderer;
  if (innerVideoRenderer) {
    return innerVideoRenderer.videoId || null;
  }

  if (content.lockupViewModel?.contentId) {
    return content.lockupViewModel.contentId;
  }

  if (content.lockupViewModel) {
    return nonEmptyStringOrNull(content.lockupViewModel.videoId);
  }

  return content.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || null;
}

function nonEmptyStringOrNull(value: unknown) {
  const parsed = nonEmptyStringSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
