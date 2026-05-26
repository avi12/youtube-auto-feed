import { fetchInitialVideos } from "../api/fetch";
import { isRichShelfRenderer, isShelfRenderer } from "../api/guards";
import { videoIdFromRichItem } from "../dom/rich-item";
import { deepArray, isPolymerElement, isRecord, videoIdFromShelfListItem } from "../helpers";
import type { InnerTubeRichGridItem, Prettify, VideoSnapshot } from "../types";

interface DomBand {
  type: "inline" | "richShelf" | "shelf";
  title: string;
  domIndex: number;
  videoIds: string[];
}

interface ApiBand {
  title: string;
  videoIds: string[];
}

interface BandDiff {
  title: string;
  domIndex: number;
  domVideoIds: string[];
  apiVideoIds: string[];
  onlyInDom: string[];
  onlyInApi: string[];
  isOrderMatch: boolean;
}

export interface LayoutIntegrityReport {
  timestamp: string;
  isPass: boolean;
  isBandOrderMatch: boolean;
  domBandTitles: string[];
  apiBandTitles: string[];
  bandDiffs: BandDiff[];
}

interface BandCollections {
  domBands: DomBand[];
  apiBands: ApiBand[];
}

function captureDomBands() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  const isGridUsable = !!elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data);
  if (!isGridUsable) {
    return [];
  }

  const contents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  const bands: Prettify<DomBand>[] = [];
  let currentInlineBand: Prettify<DomBand> | null = null;

  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];

    // Positional band attribution: root-level videos belong to whatever section header preceded them
    const inlineVideoId = videoIdFromRichItem(item);
    if (inlineVideoId) {
      if (!currentInlineBand) {
        currentInlineBand = {
          type: "inline",
          title: "",
          domIndex: i,
          videoIds: []
        };
        bands.push(currentInlineBand);
      }

      currentInlineBand.videoIds.push(inlineVideoId);
      continue;
    }

    currentInlineBand = null;

    const richShelfRenderer = item?.richSectionRenderer?.content?.richShelfRenderer;
    if (richShelfRenderer) {
      const title = isRichShelfRenderer(richShelfRenderer) ? richShelfRenderer.title?.runs?.[0]?.text ?? "" : "";
      const shelfContents = deepArray<InnerTubeRichGridItem>(richShelfRenderer, "contents");
      const videoIds = shelfContents
        .map(shelfItem => videoIdFromRichItem(shelfItem))
        .filter((id): id is string => id !== null);
      bands.push({
        type: "richShelf",
        title,
        domIndex: i,
        videoIds
      });
      continue;
    }

    const shelfRenderer = item?.richSectionRenderer?.content?.shelfRenderer;
    const shelfTitle = isShelfRenderer(shelfRenderer) ? shelfRenderer.title?.runs?.[0]?.text ?? "" : "";
    const listItems = [
      ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
      ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
    ];
    if (listItems.length > 0) {
      const videoIds = listItems
        .map(listItem => videoIdFromShelfListItem(listItem))
        .filter(id => id !== "");
      bands.push({
        type: "shelf",
        title: shelfTitle,
        domIndex: i,
        videoIds
      });
    }
  }

  return bands;
}

function captureApiBands({ snapshots, sectionOrder }: {
  snapshots: Prettify<VideoSnapshot>[];
  sectionOrder: string[];
}) {
  const bands: Prettify<ApiBand>[] = [];

  const inlineVideoIds = snapshots
    .filter(snapshot => snapshot.sectionTitle === "")
    .map(snapshot => snapshot.videoId);
  if (inlineVideoIds.length > 0) {
    bands.push({
      title: "",
      videoIds: inlineVideoIds
    });
  }

  // sectionOrder may repeat the same shelf when YouTube emits duplicates; collapse to first occurrence
  const seenSections = new Set<string>();
  for (const sectionTitle of sectionOrder) {
    if (seenSections.has(sectionTitle)) {
      continue;
    }

    seenSections.add(sectionTitle);

    const sectionVideoIds = snapshots
      .filter(snapshot => snapshot.sectionTitle === sectionTitle)
      .map(snapshot => snapshot.videoId);
    if (sectionVideoIds.length > 0) {
      bands.push({
        title: sectionTitle,
        videoIds: sectionVideoIds
      });
    }
  }

  return bands;
}

function computeBandDiffs({ domBands, apiBands }: Prettify<BandCollections>) {
  const apiBandByTitle = new Map(apiBands.map(band => [band.title, band]));
  const bandDiffs: Prettify<BandDiff>[] = [];
  let isAllBandsPass = true;

  for (const domBand of domBands) {
    const { title, domIndex, videoIds: domVideoIds } = domBand;
    const apiBand = apiBandByTitle.get(title);
    const apiVideoIds = apiBand?.videoIds ?? [];

    const domVideoIdSet = new Set(domVideoIds);
    const apiVideoIdSet = new Set(apiVideoIds);

    const onlyInDom = domVideoIds.filter(id => !apiVideoIdSet.has(id));
    const onlyInApi = apiVideoIds.filter(id => !domVideoIdSet.has(id));

    // Compare shared-id sequences from each side to detect ordering drift
    const sharedInDomOrder = domVideoIds.filter(id => apiVideoIdSet.has(id));
    const sharedInApiOrder = apiVideoIds.filter(id => domVideoIdSet.has(id));
    const isOrderMatch = JSON.stringify(sharedInDomOrder) === JSON.stringify(sharedInApiOrder);
    const isBandFailing = onlyInDom.length > 0 || onlyInApi.length > 0 || !isOrderMatch;
    if (isBandFailing) {
      isAllBandsPass = false;
    }

    bandDiffs.push({
      title: title || "(inline)",
      domIndex,
      domVideoIds,
      apiVideoIds,
      onlyInDom,
      onlyInApi,
      isOrderMatch
    });
  }

  return {
    bandDiffs,
    isAllBandsPass
  };
}

function buildReport({ domBands, apiBands }: Prettify<BandCollections>) {
  const domBandTitles = domBands.map(band => band.title || "(inline)");
  const apiBandTitles = apiBands.map(band => band.title || "(inline)");
  const isBandOrderMatch = JSON.stringify(domBandTitles) === JSON.stringify(apiBandTitles);

  const { bandDiffs, isAllBandsPass } = computeBandDiffs({
    domBands,
    apiBands
  });

  return {
    timestamp: new Date().toISOString(),
    isPass: isBandOrderMatch && isAllBandsPass,
    isBandOrderMatch,
    domBandTitles,
    apiBandTitles,
    bandDiffs
  };
}

function persistReport(report: Prettify<LayoutIntegrityReport>) {
  try {
    const stored = sessionStorage.getItem("__ytsua_layout_checks");
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    const history: Prettify<LayoutIntegrityReport>[] = Array.isArray(parsed) ? parsed : [];
    history.push(report);

    // Cap stored history so repeated checks don't fill sessionStorage
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }

    sessionStorage.setItem("__ytsua_layout_checks", JSON.stringify(history));
  } catch {}
}

function logReport(report: Prettify<LayoutIntegrityReport>) {
  const { isPass, timestamp, isBandOrderMatch, domBandTitles, apiBandTitles, bandDiffs } = report;
  const statusLabel = isPass ? "PASS" : "FAIL";
  console.group(`[YTSUA] Layout Integrity ${statusLabel} - ${timestamp}`);

  if (!isBandOrderMatch) {
    console.warn("Band order MISMATCH");
    console.log("DOM:", domBandTitles);
    console.log("API:", apiBandTitles);
  } else {
    console.log("Band order OK:", domBandTitles.join(" -> "));
  }

  for (const diff of bandDiffs) {
    const { title, domIndex, domVideoIds, apiVideoIds, onlyInDom, onlyInApi, isOrderMatch } = diff;
    const isBandPass = onlyInDom.length === 0 && onlyInApi.length === 0 && isOrderMatch;
    const bandLabel = isBandPass ? "OK" : "FAIL";
    console.group(`[${bandLabel}] "${title}" DOM[${domIndex}] - DOM ${domVideoIds.length} ids vs API ${apiVideoIds.length} ids`);

    if (onlyInDom.length > 0) {
      console.warn("Only in DOM:", onlyInDom);
    }

    if (onlyInApi.length > 0) {
      console.warn("Only in API:", onlyInApi);
    }

    if (!isOrderMatch) {
      console.warn("Intra-band order MISMATCH");
      console.log("DOM order:", domVideoIds);
      console.log("API order:", apiVideoIds);
    }

    if (isBandPass) {
      console.log("IDs and order match");
    }

    console.groupEnd();
  }

  console.groupEnd();
  persistReport(report);
}

export async function checkLayoutIntegrity() {
  const domBands = captureDomBands();
  const apiResult = await fetchInitialVideos();
  if (!apiResult) {
    console.error("[YTSUA] Layout integrity check: API fetch failed");
    return null;
  }

  const apiBands = captureApiBands({
    snapshots: apiResult.snapshots,
    sectionOrder: apiResult.sectionOrder
  });
  const report = buildReport({
    domBands,
    apiBands
  });
  logReport(report);
  return report;
}
