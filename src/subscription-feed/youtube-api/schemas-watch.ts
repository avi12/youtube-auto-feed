import { z } from "../../shared/zod";
import { thumbnailSchema, titleSchema } from "./schemas-renderers";

// The watch page's /next payload. The page itself is built from it, so the same shape describes both a
// fresh fetch and the copy the page keeps on ytd-watch-flexy: the video's own title, the channel row,
// the related list (first page, chip reloads and scroll pages), and the suggestions the player paints
// on its end screen. The first related page wraps its videos in an item section; chip reloads and
// scroll pages list them bare. Videos themselves are left to the shared lockup guards.

const continuationItemRendererSchema = z.looseObject({
  continuationEndpoint: z.looseObject({
    continuationCommand: z.looseObject({ token: z.string().optional() }).optional()
  }).optional()
});

const watchNextFeedLeafSchema = z.looseObject({ continuationItemRenderer: continuationItemRendererSchema.optional() });

export const watchNextFeedItemSchema = z.looseObject({
  itemSectionRenderer: z.looseObject({
    targetId: z.string().optional(),
    contents: z.array(watchNextFeedLeafSchema).optional()
  }).optional(),
  continuationItemRenderer: continuationItemRendererSchema.optional()
});

const watchNextFeedContinuationSchema = z.looseObject({
  targetId: z.string().optional(),
  continuationItems: z.array(watchNextFeedItemSchema).optional()
});

const updatedMetadataCommandSchema = z.looseObject({
  updatedMetadataEndpoint: z.looseObject({
    videoId: z.string(),
    initialDelayMs: z.number().optional(),
    params: z.string().optional()
  })
});

const thumbnailListSchema = z.looseObject({ thumbnails: z.array(thumbnailSchema).optional() });

export const endScreenVideoRendererSchema = z.looseObject({
  videoId: z.string(),
  title: titleSchema.optional(),
  thumbnail: thumbnailListSchema.optional(),
  shortViewCountText: titleSchema.optional(),
  publishedTimeText: titleSchema.optional()
});

const playerOverlayAutoplayRendererSchema = z.looseObject({
  videoId: z.string().optional(),
  videoTitle: titleSchema.optional(),
  shortViewCountText: titleSchema.optional(),
  publishedTimeText: titleSchema.optional(),
  background: thumbnailListSchema.optional()
});

export const watchNextResponseSchema = z.looseObject({
  currentVideoEndpoint: z.looseObject({
    watchEndpoint: z.looseObject({ videoId: z.string().optional() }).optional()
  }).optional(),
  contents: z.looseObject({
    twoColumnWatchNextResults: z.looseObject({
      results: z.looseObject({
        results: z.looseObject({
          contents: z.array(
            z.looseObject({
              videoPrimaryInfoRenderer: z.looseObject({
                title: titleSchema.optional(),
                updatedMetadataEndpoint: updatedMetadataCommandSchema.optional()
              }).optional(),
              videoSecondaryInfoRenderer: z.looseObject({
                owner: z.looseObject({
                  videoOwnerRenderer: z.looseObject({ subscriberCountText: titleSchema.optional() }).optional()
                }).optional()
              }).optional()
            })
          ).optional()
        }).optional()
      }).optional(),
      secondaryResults: z.looseObject({
        secondaryResults: z.looseObject({ results: z.array(watchNextFeedItemSchema).optional() }).optional()
      }).optional()
    }).optional()
  }).optional(),
  playerOverlays: z.looseObject({
    playerOverlayRenderer: z.looseObject({
      endScreen: z.looseObject({
        watchNextEndScreenRenderer: z.looseObject({
          results: z.array(
            z.looseObject({ endScreenVideoRenderer: endScreenVideoRendererSchema.optional() })
          ).optional()
        }).optional()
      }).optional(),
      autoplay: z.looseObject({
        playerOverlayAutoplayRenderer: playerOverlayAutoplayRendererSchema.optional()
      }).optional()
    }).optional()
  }).optional(),
  onResponseReceivedEndpoints: z.array(
    z.looseObject({
      appendContinuationItemsAction: watchNextFeedContinuationSchema.optional(),
      reloadContinuationItemsCommand: watchNextFeedContinuationSchema.optional()
    })
  ).optional()
});
