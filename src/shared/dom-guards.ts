import { z } from "./zod";
import { createLazyGuard } from "./zod-guard";

/** Type guards for the DOM classes the extension tells apart, in the same zod form as the page-object guards */
export const isElement = createLazyGuard(() => z.instanceof(Element));
export const isHtmlElement = createLazyGuard(() => z.instanceof(HTMLElement));
export const isImageElement = createLazyGuard(() => z.instanceof(HTMLImageElement));
export const isAnchorElement = createLazyGuard(() => z.instanceof(HTMLAnchorElement));
export const isVideoElement = createLazyGuard(() => z.instanceof(HTMLVideoElement));
export const isRequest = createLazyGuard(() => z.instanceof(Request));
