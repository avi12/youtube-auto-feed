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

function onMessage({ type, handler }: {
  type: YtsuaMessage;
  handler: () => void;
}) {
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
