import { z } from "../../shared/zod";
import {
  richGridContentsSchema,
  richItemContentSchema,
  richShelfContentsSchema,
  shelfRendererInnerSchema
} from "./schemas-renderers";

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

export const gridDataSchema = z.looseObject({ contents: richGridContentsSchema.optional() });

export const richItemDataSchema = z.looseObject({ content: richItemContentSchema.optional() });

export const gridVideoDataSchema = z.looseObject({ videoId: z.string().optional() });

export const richShelfDataSchema = z.looseObject({
  isExpanded: z.boolean().optional(),
  contents: richShelfContentsSchema.optional()
});
