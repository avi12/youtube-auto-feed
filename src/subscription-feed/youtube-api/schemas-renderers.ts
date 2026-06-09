import { z } from "../../shared/zod";

// Zod mirrors of the InnerTube renderer shapes. Fields are optional and looseObject passes unmodelled
// siblings through; the discriminating fields stay required only in the guard schemas in guards.ts.

const textRunSchema = z.looseObject({ text: z.string() });

export const titleSchema = z.looseObject({
  runs: z.array(textRunSchema).optional(),
  simpleText: z.string().optional()
});

export const thumbnailSchema = z.looseObject({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional()
});

export const videoRendererSchema = z.looseObject({ videoId: z.string() });

const reelWatchEndpointSchema = z.looseObject({ videoId: z.string() });

export const shortsOnTapSchema = z.looseObject({
  innertubeCommand: z.looseObject({
    reelWatchEndpoint: reelWatchEndpointSchema.optional()
  }).optional()
});

export const richItemContentSchema = z.looseObject({
  videoRenderer: videoRendererSchema.optional(),
  gridVideoRenderer: videoRendererSchema.optional(),
  richGridMediaRenderer: z.looseObject({
    content: z.looseObject({ videoRenderer: videoRendererSchema.optional() }).optional()
  }).optional(),
  lockupViewModel: z.looseObject({
    contentId: z.string().optional(),
    videoId: z.string().optional()
  }).optional(),
  shortsLockupViewModel: z.looseObject({ onTap: shortsOnTapSchema.optional() }).optional()
});

const richItemRendererSchema = z.looseObject({ content: richItemContentSchema.optional() });

export const richShelfContentsSchema = z.array(
  z.looseObject({ richItemRenderer: richItemRendererSchema.optional() })
);

const shelfItemsSchema = z.array(richItemContentSchema);

export const shelfContentSchema = z.looseObject({
  horizontalListRenderer: z.looseObject({ items: shelfItemsSchema.optional() }).optional(),
  gridRenderer: z.looseObject({ items: shelfItemsSchema.optional() }).optional()
});

const richShelfRendererInnerSchema = z.looseObject({
  title: titleSchema.optional(),
  contents: richShelfContentsSchema.optional()
});

export const shelfRendererInnerSchema = z.looseObject({
  title: titleSchema.optional(),
  content: shelfContentSchema.optional()
});

const richGridItemSchema = z.looseObject({
  richItemRenderer: richItemRendererSchema.optional(),
  richSectionRenderer: z.looseObject({
    content: z.looseObject({
      richShelfRenderer: richShelfRendererInnerSchema.optional(),
      shelfRenderer: shelfRendererInnerSchema.optional()
    }).optional()
  }).optional(),
  continuationItemRenderer: z.looseObject({
    continuationEndpoint: z.looseObject({
      continuationCommand: z.looseObject({ token: z.string().optional() }).optional()
    }).optional()
  }).optional()
});

export const richGridContentsSchema = z.array(richGridItemSchema);
