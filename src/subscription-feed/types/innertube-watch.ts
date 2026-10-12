import type { z } from "../../shared/zod";
import type {
  endScreenVideoRendererSchema,
  watchNextFeedItemSchema,
  watchNextResponseSchema
} from "../youtube-api/schemas-watch";

// The /next payload is modelled once, as Zod schemas; these types are read straight off them.

export type InnerTubeWatchNextResponse = z.infer<typeof watchNextResponseSchema>;
export type WatchNextFeedItem = z.infer<typeof watchNextFeedItemSchema>;
export type EndScreenVideoRenderer = z.infer<typeof endScreenVideoRendererSchema>;
