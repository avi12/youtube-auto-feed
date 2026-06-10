import { z } from "../../shared/zod";

// YouTube's public oEmbed endpoint resolves a video's uploader channel - as a @handle - and signals
// whether the video still exists, for a few hundred bytes instead of the tens of KB an authenticated
// /player call costs. It is unauthenticated, so it cannot report the viewer's subscription state; the
// caller tests the returned handle against the subscribed-channel set. A 404 means the video is gone
// (deleted or never existed). Any other non-OK response (embedding disabled, age or members restricted,
// private) is reported as still-available with an unknown channel, so a valid video is never removed on
// a transient or restriction-only failure - only a definitive 404 or a known-unsubscribed channel does.

const NOT_FOUND = 404;
const HANDLE = /\/(@[\w.-]+)$/;
const oembedSchema = z.looseObject({ author_url: z.string().optional() });

export async function fetchVideoChannel(videoId: string) {
  const response = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  ).catch(() => null);
  if (response?.status === NOT_FOUND) {
    return {
      handle: null,
      isAvailable: false
    };
  }

  const parsed = oembedSchema.safeParse(response?.ok ? await response.json().catch(() => null) : null);
  const handle = parsed.success ? parsed.data.author_url?.match(HANDLE)?.[1]?.toLowerCase() ?? null : null;
  return {
    handle,
    isAvailable: true
  };
}
