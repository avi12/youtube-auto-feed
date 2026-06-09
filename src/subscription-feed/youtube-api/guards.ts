import { z } from "../../shared/zod";
import type {
  InnerTubeBrowseResponse,
  InnerTubeRichShelfRenderer,
  InnerTubeShelfRenderer,
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "../types/innertube";
import {
  browseContentsSchema,
  richShelfContentsSchema,
  shelfContentSchema,
  shortsOnTapSchema,
  titleSchema,
  videoRendererSchema
} from "./schemas";

const lockupViewModelSchema = z.looseObject({ contentId: z.string() });
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

export function isInnerTubeBrowseResponse(value: unknown): value is InnerTubeBrowseResponse {
  return browseResponseSchema.safeParse(value).success;
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
  viewCountFromRenderer
} from "./renderer-fields";
