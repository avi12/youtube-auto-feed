type BroadcastMessages = Record<string, unknown>;

type BroadcastEnvelope<T extends BroadcastMessages> = {
  [K in keyof T]: { type: K; data: T[K] };
}[keyof T];

function defineChannel<T extends BroadcastMessages>(channelName: string) {
  function sendMessage<K extends keyof T & string>(
    ...[type, data]: T[K] extends void ? [K] : [K, T[K]]
  ) {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ type, data });
    channel.close();
  }

  function onMessage<K extends keyof T & string>(
    type: K,
    handler: T[K] extends void ? () => void : (data: T[K]) => void
  ) {
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = ({ data }: MessageEvent<BroadcastEnvelope<T>>) => {
      if (data?.type !== type) {
        return;
      }
      (handler as (data: T[K]) => void)(data.data as T[K]);
    };
    return () => channel.close();
  }

  return { sendMessage, onMessage };
}

type YtsuaMessages = {
  "subscription-change": void;
};

export const ytsuaChannel = defineChannel<YtsuaMessages>("ytsua");
