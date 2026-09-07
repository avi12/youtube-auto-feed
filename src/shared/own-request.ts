// The interceptor mirrors YouTube's own subscriptions browse calls to the monitor. The monitor now
// makes that same call itself, so its requests carry this marker and the interceptor skips them -
// without it a poll would be echoed back through the message channel, serialising the whole feed
// response on every tick.

export const OWN_REQUEST_MARKER_HEADER = "X-YTAF";
