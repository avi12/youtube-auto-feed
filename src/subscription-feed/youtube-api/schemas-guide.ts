import { z } from "../../shared/zod";

const guideChannelEntrySchema = z.looseObject({
  navigationEndpoint: z.looseObject({
    browseEndpoint: z.looseObject({
      browseId: z.string().optional(),
      canonicalBaseUrl: z.string().optional()
    }).optional()
  }).optional()
});

export const guideResponseSchema = z.looseObject({
  items: z.array(
    z.looseObject({
      guideSubscriptionsSectionRenderer: z.looseObject({
        items: z.array(
          z.looseObject({
            guideEntryRenderer: guideChannelEntrySchema.optional(),
            guideCollapsibleEntryRenderer: z.looseObject({
              expandableItems: z.array(
                z.looseObject({ guideEntryRenderer: guideChannelEntrySchema.optional() })
              ).optional()
            }).optional()
          })
        ).optional()
      }).optional()
    })
  ).optional()
});
