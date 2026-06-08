import { z } from "../../shared/zod";

// Precise Zod mirrors of the InnerTube renderer shapes the extension reads. Fields are optional to
// match YouTube's loosely-typed, variable payloads (looseObject also lets unmodelled siblings pass);
// the discriminating leaf fields stay required only inside the guard schemas in guards.ts.

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

const shelfRendererInnerSchema = z.looseObject({
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

export const browseContentsSchema = z.looseObject({
  twoColumnBrowseResultsRenderer: z.looseObject({
    tabs: z.array(
      z.looseObject({
        tabRenderer: z.looseObject({
          content: z.looseObject({
            richGridRenderer: z.looseObject({ contents: richGridContentsSchema.optional() }).optional(),
            sectionListRenderer: z.looseObject({
              contents: z.array(
                z.looseObject({
                  itemSectionRenderer: z.looseObject({
                    contents: z.array(z.looseObject({ shelfRenderer: shelfRendererInnerSchema.optional() })).optional()
                  }).optional()
                })
              ).optional()
            }).optional()
          }).optional()
        }).optional()
      })
    ).optional()
  }).optional()
});

// Polymer element `.data` shapes for the elements the extension reads.
export const gridDataSchema = z.looseObject({ contents: richGridContentsSchema.optional() });

export const richItemDataSchema = z.looseObject({ content: richItemContentSchema.optional() });

export const gridVideoDataSchema = z.looseObject({ videoId: z.string().optional() });

export const richShelfDataSchema = z.looseObject({
  isExpanded: z.boolean().optional(),
  contents: richShelfContentsSchema.optional()
});
