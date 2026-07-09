import { isInViewport } from "../dom/animations";
import { GRID_ITEM_SELECTOR, type RichItemElement } from "../dom/mirror/mirror-constants";
import { thumbnailUrlFromContent } from "../dom/rich-item";
import { findThumbnailImgInItem } from "../dom/update/thumbnail-locate";
import { videoIdFromData } from "../utils/video-id";

// Dev-only watchdog for the "updated thumbnail flashes blank" report. Every scan it inspects each
// in-viewport tile: a painted <img> that has gone empty or decodes to zero width is blank. A blank
// that clears within one scan is logged as transient; a blank that persists past the report delay is
// logged once with the video id, both URLs, and the painted src so the offending picture can be
// inspected directly rather than inferred. Strips from store builds with the rest of the dev bridge.

const BLANK_SCAN_INTERVAL_MS = 2 * 1000;
const PERSISTENT_BLANK_REPORT_MS = 4 * 1000;

interface BlankEvent {
  videoId: string;
  blankSince: number;
  dataUrl: string;
  paintedSrc: string;
  isReported: boolean;
}

export interface BlankReportEntry {
  videoId: string;
  durationMs: number;
  dataUrl: string;
  paintedSrc: string;
  isPersistent: boolean;
}

const blankByVideoId = new Map<string, BlankEvent>();
const reportLog: BlankReportEntry[] = [];

function isImgBlank(elImg: HTMLImageElement) {
  const src = elImg.getAttribute("src") ?? "";
  if (src === "") {
    return true;
  }

  return elImg.complete && elImg.naturalWidth === 0;
}

interface BlankTile {
  videoId: string;
  dataUrl: string;
  paintedSrc: string;
}

function collectBlankTiles() {
  const blanks: BlankTile[] = [];
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    if (!isInViewport(elItem)) {
      continue;
    }

    const elImg = findThumbnailImgInItem(elItem);
    const videoId = videoIdFromData(elItem.data);
    if (!elImg || !videoId || !isImgBlank(elImg)) {
      continue;
    }

    blanks.push({
      videoId,
      dataUrl: elItem.data.content ? thumbnailUrlFromContent(elItem.data.content) : "",
      paintedSrc: elImg.getAttribute("src") ?? ""
    });
  }
  return blanks;
}

function recordEntry(entry: BlankReportEntry) {
  reportLog.push(entry);
  const tag = entry.isPersistent ? "PERSISTENT" : "transient";
  console.warn(`[ytaf blank-detector] ${tag} blank on ${entry.videoId} for ${entry.durationMs}ms`, entry);
}

function scanForBlankThumbnails() {
  const now = performance.now();
  const blankIds = new Set<string>();
  for (const { videoId, dataUrl, paintedSrc } of collectBlankTiles()) {
    blankIds.add(videoId);
    const existing = blankByVideoId.get(videoId);
    if (!existing) {
      blankByVideoId.set(videoId, {
        videoId,
        blankSince: now,
        dataUrl,
        paintedSrc,
        isReported: false
      });
      continue;
    }

    const isPersistent = now - existing.blankSince >= PERSISTENT_BLANK_REPORT_MS;
    if (isPersistent && !existing.isReported) {
      existing.isReported = true;
      recordEntry({
        videoId,
        durationMs: Math.round(now - existing.blankSince),
        dataUrl,
        paintedSrc,
        isPersistent: true
      });
    }
  }

  for (const [videoId, event] of blankByVideoId) {
    if (blankIds.has(videoId)) {
      continue;
    }

    blankByVideoId.delete(videoId);

    if (!event.isReported) {
      recordEntry({
        videoId,
        durationMs: Math.round(now - event.blankSince),
        dataUrl: event.dataUrl,
        paintedSrc: event.paintedSrc,
        isPersistent: false
      });
    }
  }
}

export function startBlankThumbnailDetector() {
  setInterval(scanForBlankThumbnails, BLANK_SCAN_INTERVAL_MS);
  return () => [...reportLog];
}
