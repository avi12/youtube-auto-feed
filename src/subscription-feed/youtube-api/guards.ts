import { z } from "../../shared/zod";
import type {
  ChannelVideoPlayerRenderer,
  InnerTubeBrowseResponse,
  InnerTubeRichGridItem,
  InnerTubeRichShelfRenderer,
  InnerTubeShelfRenderer,
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "../types/innertube";
import {
  browseContentsSchema,
  channelVideoPlayerRendererSchema,
  gridDataSchema,
  richShelfContentsSchema,
  richShelfDataSchema,
  shelfContentSchema,
  shortsOnTapSchema,
  titleSchema,
  videoRendererSchema
} from "./schemas";

export interface RichGridData {
  contents?: InnerTubeRichGridItem[];
}

export interface RichShelfData {
  isExpanded?: boolean;
  contents?: InnerTubeRichGridItem[];
}

const lockupViewModelSchema = z
  .looseObject({
    contentId: z.string().optional(),
    videoId: z.string().optional()
  })
  .refine(lockup => !!(lockup.contentId || lockup.videoId));
const shortsLockupViewModelSchema = z.looseObject({ onTap: shortsOnTapSchema });
const browseResponseSchema = z.looseObject({ contents: browseContentsSchema });
const richShelfRendererSchema = z.looseObject({
  title: titleSchema,
  contents: richShelfContentsSchema
});
const shelfRendererSchema = z.looseObject({
  title: titleSchema,
  content: shelfContentSchema
});

export function isVideoRenderer(value: unknown): value is InnerTubeVideoRenderer {
  return videoRendererSchema.safeParse(value).success;
}

export function isLockupViewModel(value: unknown): value is LockupViewModel {
  return lockupViewModelSchema.safeParse(value).success;
}

export function isShortsLockupViewModel(value: unknown): value is ShortsLockupViewModel {
  return shortsLockupViewModelSchema.safeParse(value).success;
}

export function isChannelVideoPlayerRenderer(value: unknown): value is ChannelVideoPlayerRenderer {
  return channelVideoPlayerRendererSchema.safeParse(value).success;
}

export function isInnerTubeBrowseResponse(value: unknown): value is InnerTubeBrowseResponse {
  return browseResponseSchema.safeParse(value).success;
}

export function isRichGridData(value: unknown): value is RichGridData {
  return gridDataSchema.safeParse(value).success;
}

export function isRichShelfData(value: unknown): value is RichShelfData {
  return richShelfDataSchema.safeParse(value).success;
}

export function isRichShelfRenderer(value: unknown): value is InnerTubeRichShelfRenderer {
  return richShelfRendererSchema.safeParse(value).success;
}

export function isShelfRenderer(value: unknown): value is InnerTubeShelfRenderer {
  return shelfRendererSchema.safeParse(value).success;
}

export {
  statusFromLockup,
  statusFromRenderer,
  thumbnailUrlFromShortsLockup,
  viewCountFromRenderer
} from "./renderer-fields";
