// A channel handle is the tail of a channel URL, and two unrelated sources hand one over: the guide's
// canonicalBaseUrl and oEmbed's author_url. They are only comparable if both are read the same way, so
// both go through here and both come back lowercased.

const HANDLE = /\/(@[\w.-]+)$/;

export function channelHandleFromUrl(url: string | undefined) {
  return url?.match(HANDLE)?.[1]?.toLowerCase() ?? null;
}
