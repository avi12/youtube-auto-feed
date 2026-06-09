import type { Prettify } from "../subscription-feed/types/prettify";
import { z } from "./zod";

const CHANNEL_NAME = "ytaf";

const ytafEnvelopeSchema = z.object({ type: z.literal("subscription-change") });

type YtafEnvelope = z.infer<typeof ytafEnvelopeSchema>;
type YtafMessage = YtafEnvelope["type"];

function isYtafEnvelope(value: unknown): value is YtafEnvelope {
  return ytafEnvelopeSchema.safeParse(value).success;
}

type OnMessageParams = Prettify<{
  type: YtafMessage;
  handler: () => void;
}>;
export const ytafChannel = {
  sendMessage(type: YtafMessage) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type });
    channel.close();
  },
  onMessage({ type, handler }: OnMessageParams) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = ({ data }) => {
      const isMatchingEnvelope = isYtafEnvelope(data) && data.type === type;
      if (isMatchingEnvelope) {
        handler();
      }
    };
    return () => channel.close();
  }
};
