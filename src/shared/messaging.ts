import type { Prettify } from "../subscription-feed/types/prettify";

const CHANNEL_NAME = "ytsua";

type YtsuaMessage = "subscription-change";

interface YtsuaEnvelope {
  type: YtsuaMessage;
}

function isYtsuaEnvelope(value: unknown): value is YtsuaEnvelope {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function sendMessage(type: YtsuaMessage) {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type });
  channel.close();
}

type OnMessageParams = Prettify<{
  type: YtsuaMessage;
  handler: () => void;
}>;
function onMessage({ type, handler }: OnMessageParams) {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = ({ data }) => {
    const isMatchingEnvelope = isYtsuaEnvelope(data) && data.type === type;
    if (isMatchingEnvelope) {
      handler();
    }
  };
  return () => channel.close();
}

export const ytsuaChannel = {
  sendMessage,
  onMessage
};
