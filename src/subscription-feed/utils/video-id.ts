import { z } from "../../shared/zod";
import { isVideoRenderer } from "../youtube-api/guards";
import { richItemContentSchema, videoRendererSchema } from "../youtube-api/schemas";

const nonEmptyStringSchema = z.string().min(1);

const dataSchema = z.looseObject({
  content: richItemContentSchema.optional().catch(undefined)
});

const listItemSchema = z.looseObject({
  videoRenderer: videoRendererSchema.optional().catch(undefined),
  gridVideoRenderer: videoRendererSchema.optional().catch(undefined)
});

// Extracts a videoId from a Polymer element's `data` regardless of renderer shape
// (videoRenderer, gridVideoRenderer, richGridMediaRenderer, lockupViewModel, shortsLockupViewModel).
// Returns null for unrecognised shapes (continuation items, section headers).
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

  // Some lockup payloads use `videoId` instead of `contentId`.
  if (content.lockupViewModel?.contentId) {
    return content.lockupViewModel.contentId;
  }

  if (content.lockupViewModel) {
    return stringOrNull(content.lockupViewModel.videoId);
  }

  return content.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || null;
}

// For legacy shelf list items (horizontalListRenderer / gridRenderer) where the renderer is at
// the item root, not nested under `content`.
export function videoIdFromShelfListItem(listItem: unknown) {
  const parsed = listItemSchema.safeParse(listItem);
  if (!parsed.success) {
    return "";
  }

  if (parsed.data.videoRenderer) {
    return parsed.data.videoRenderer.videoId;
  }

  if (parsed.data.gridVideoRenderer) {
    return parsed.data.gridVideoRenderer.videoId;
  }

  return "";
}

function stringOrNull(value: unknown) {
  const parsed = nonEmptyStringSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
