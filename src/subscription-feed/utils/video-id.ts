import { z } from "../../shared/zod";
import {
  isLockupViewModel,
  isShortsLockupViewModel,
  isVideoRenderer,
  videoRendererSchema
} from "../youtube-api/guards";

const nonEmptyStringSchema = z.string().min(1);

const dataSchema = z.looseObject({
  content: z.looseObject({}).optional().catch(undefined)
});

const contentSchema = z.looseObject({
  videoRenderer: videoRendererSchema.optional().catch(undefined),
  gridVideoRenderer: videoRendererSchema.optional().catch(undefined),
  richGridMediaRenderer: z.looseObject({}).optional().catch(undefined),
  lockupViewModel: z.looseObject({ contentId: z.string().optional() }).optional().catch(undefined),
  shortsLockupViewModel: z.looseObject({}).optional().catch(undefined)
});

const richGridMediaRendererSchema = z.looseObject({
  content: z.looseObject({}).optional().catch(undefined)
});

const richGridInnerSchema = z.looseObject({
  videoRenderer: videoRendererSchema.optional().catch(undefined)
});

const lockupViewModelSchema = z.looseObject({
  videoId: z.string().optional()
});

const listItemSchema = z.looseObject({
  videoRenderer: videoRendererSchema.optional().catch(undefined),
  gridVideoRenderer: videoRendererSchema.optional().catch(undefined)
});

// Extracts a videoId from a Polymer element's `data` regardless of renderer shape
// (videoRenderer, gridVideoRenderer, richGridMediaRenderer, lockupViewModel, shortsLockupViewModel).
// Returns null for unrecognised shapes (continuation items, section headers).
export function videoIdFromData(data: unknown) {
  const dataParsed = dataSchema.safeParse(data);
  if (!dataParsed.success) {
    return null;
  }

  if (isVideoRenderer(data)) {
    return data.videoId || null;
  }

  const { content } = dataParsed.data;
  const contentParsed = contentSchema.safeParse(content);
  if (!contentParsed.success) {
    return null;
  }

  const {
    videoRenderer,
    gridVideoRenderer,
    richGridMediaRenderer,
    lockupViewModel,
    shortsLockupViewModel
  } = contentParsed.data;
  if (isVideoRenderer(videoRenderer)) {
    return videoRenderer.videoId || null;
  }

  if (isVideoRenderer(gridVideoRenderer)) {
    return gridVideoRenderer.videoId || null;
  }

  const rgmrParsed = richGridMediaRendererSchema.safeParse(richGridMediaRenderer);
  const richGridInner = rgmrParsed.success ? rgmrParsed.data.content : null;
  const richGridInnerParsed = richGridInnerSchema.safeParse(richGridInner);
  if (richGridInnerParsed.success && isVideoRenderer(richGridInnerParsed.data.videoRenderer)) {
    return richGridInnerParsed.data.videoRenderer.videoId || null;
  }

  // Some lockup payloads use `videoId` instead of `contentId`.
  if (isLockupViewModel(lockupViewModel) && lockupViewModel.contentId) {
    return lockupViewModel.contentId;
  }

  const lockupViewModelParsed = lockupViewModelSchema.safeParse(lockupViewModel);
  if (lockupViewModelParsed.success) {
    return stringOrNull(lockupViewModelParsed.data.videoId);
  }

  if (isShortsLockupViewModel(shortsLockupViewModel)) {
    return shortsLockupViewModel.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || null;
  }

  return null;
}

// For legacy shelf list items (horizontalListRenderer / gridRenderer) where the renderer is at
// the item root, not nested under `content`.
export function videoIdFromShelfListItem(listItem: unknown) {
  const parsed = listItemSchema.safeParse(listItem);
  if (!parsed.success) {
    return "";
  }

  const { videoRenderer, gridVideoRenderer } = parsed.data;
  if (isVideoRenderer(videoRenderer)) {
    return videoRenderer.videoId;
  }

  if (isVideoRenderer(gridVideoRenderer)) {
    return gridVideoRenderer.videoId;
  }

  return "";
}

function stringOrNull(value: unknown) {
  const parsed = nonEmptyStringSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
