import { z } from "@/shared/zod";
import { thumbnailSchema, titleSchema } from "@/subscription-feed/youtube-api/schemas-renderers";

// The mobile site's feed: the same rich grid as desktop, with its own video renderer.

const timeStatusOverlaySchema = z.looseObject({
  thumbnailOverlayTimeStatusRenderer: z.looseObject({ style: z.string().optional() }).optional()
});

export const mobileVideoSchema = z.looseObject({
  videoId: z.string(),
  headline: titleSchema.optional(),
  shortViewCountText: titleSchema.optional(),
  publishedTimeText: titleSchema.optional(),
  lengthText: titleSchema.optional(),
  thumbnail: z.looseObject({ thumbnails: z.array(thumbnailSchema) }).optional(),
  thumbnailOverlays: z.array(timeStatusOverlaySchema).optional()
});

export const mobileGridItemSchema = z.looseObject({
  richItemRenderer: z
    .looseObject({
      content: z.looseObject({ videoWithContextRenderer: mobileVideoSchema.optional() }).optional()
    })
    .optional(),
  richSectionRenderer: z.looseObject({}).optional(),
  continuationItemRenderer: z.looseObject({}).optional()
});

export const mobileGridElementSchema = z.looseObject({ data: z.looseObject({ targetId: z.string() }) });

export const mobileTileElementSchema = z.looseObject({ data: z.looseObject({}) });

export const mobileBrowseResponseSchema = z.looseObject({
  contents: z.looseObject({
    singleColumnBrowseResultsRenderer: z.looseObject({
      tabs: z.array(
        z.looseObject({
          tabRenderer: z
            .looseObject({
              content: z
                .looseObject({
                  richGridRenderer: z.looseObject({ contents: z.array(mobileGridItemSchema) }).optional()
                })
                .optional()
            })
            .optional()
        })
      )
    })
  })
});

export type MobileGridItem = z.infer<typeof mobileGridItemSchema>;
