import type { Prettify } from "../subscription-feed/types/prettify";

const CHANNEL_NAME = "ytaf";

type YtafMessage = "subscription-change";

interface YtafEnvelope {
  type: YtafMessage;
}

function isYtafEnvelope(value: unknown): value is YtafEnvelope {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function sendMessage(type: YtafMessage) {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type });
  channel.close();
}

type OnMessageParams = Prettify<{
  type: YtafMessage;
  handler: () => void;
}>;
function onMessage({ type, handler }: OnMessageParams) {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = ({ data }) => {
    const isMatchingEnvelope = isYtafEnvelope(data) && data.type === type;
    if (isMatchingEnvelope) {
      handler();
    }
  };
  return () => channel.close();
}

export const ytafChannel = {
  sendMessage,
  onMessage
};
