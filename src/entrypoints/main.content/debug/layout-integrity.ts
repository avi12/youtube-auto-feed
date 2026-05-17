import { fetchInitialVideos } from "../api/fetch";
import { deepArray, deepRecord, deepString, isPolymerElement, isRecord, videoIdFromShelfListItem } from "../helpers";
import { videoIdFromRichItem } from "../dom/rich-item";
import type { VideoSnapshot } from "../types";

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

function captureDomBands(): DomBand[] {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return [];
  }

  const contents = deepArray(elGrid.data, "contents");
  const bands: DomBand[] = [];
  let currentInlineBand: DomBand | null = null;

  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];

    const inlineVideoId = videoIdFromRichItem(item);
    if (inlineVideoId) {
      if (!currentInlineBand) {
        currentInlineBand = { type: "inline", title: "", domIndex: i, videoIds: [] };
        bands.push(currentInlineBand);
      }
      currentInlineBand.videoIds.push(inlineVideoId);
      continue;
    }

    currentInlineBand = null;

    const richShelfRenderer = deepRecord(item, "richSectionRenderer", "content", "richShelfRenderer");
    if (richShelfRenderer) {
      const title = deepString(richShelfRenderer, "title", "runs", "0", "text");
      const shelfContents = deepArray(richShelfRenderer, "contents");
      const videoIds = shelfContents
        .map(shelfItem => videoIdFromRichItem(shelfItem))
        .filter((id): id is string => id !== null);
      bands.push({ type: "richShelf", title, domIndex: i, videoIds });
      continue;
    }

    const shelfTitle = deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text");
    const listItems = [
      ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
      ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
    ];
    if (listItems.length > 0) {
      const videoIds = listItems
        .map(listItem => videoIdFromShelfListItem(listItem))
        .filter(id => id !== "");
      bands.push({ type: "shelf", title: shelfTitle, domIndex: i, videoIds });
    }
  }

  return bands;
}

function captureApiBands(snapshots: VideoSnapshot[], sectionOrder: string[]): ApiBand[] {
  const bands: ApiBand[] = [];

  const inlineVideoIds = snapshots
    .filter(snapshot => snapshot.sectionTitle === "")
    .map(snapshot => snapshot.videoId);
  if (inlineVideoIds.length > 0) {
    bands.push({ title: "", videoIds: inlineVideoIds });
  }

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
      bands.push({ title: sectionTitle, videoIds: sectionVideoIds });
    }
  }

  return bands;
}

function computeBandDiffs(domBands: DomBand[], apiBands: ApiBand[]): { bandDiffs: BandDiff[]; isAllBandsPass: boolean } {
  const apiBandByTitle = new Map(apiBands.map(band => [band.title, band]));
  const bandDiffs: BandDiff[] = [];
  let isAllBandsPass = true;

  for (const domBand of domBands) {
    const apiBand = apiBandByTitle.get(domBand.title);
    const apiVideoIds = apiBand?.videoIds ?? [];

    const domVideoIdSet = new Set(domBand.videoIds);
    const apiVideoIdSet = new Set(apiVideoIds);

    const onlyInDom = domBand.videoIds.filter(id => !apiVideoIdSet.has(id));
    const onlyInApi = apiVideoIds.filter(id => !domVideoIdSet.has(id));

    const sharedInDomOrder = domBand.videoIds.filter(id => apiVideoIdSet.has(id));
    const sharedInApiOrder = apiVideoIds.filter(id => domVideoIdSet.has(id));
    const isOrderMatch = JSON.stringify(sharedInDomOrder) === JSON.stringify(sharedInApiOrder);

    if (onlyInDom.length > 0 || onlyInApi.length > 0 || !isOrderMatch) {
      isAllBandsPass = false;
    }

    bandDiffs.push({
      title: domBand.title || "(inline)",
      domIndex: domBand.domIndex,
      domVideoIds: domBand.videoIds,
      apiVideoIds,
      onlyInDom,
      onlyInApi,
      isOrderMatch
    });
  }

  return { bandDiffs, isAllBandsPass };
}

function buildReport(domBands: DomBand[], apiBands: ApiBand[]): LayoutIntegrityReport {
  const domBandTitles = domBands.map(band => band.title || "(inline)");
  const apiBandTitles = apiBands.map(band => band.title || "(inline)");
  const isBandOrderMatch = JSON.stringify(domBandTitles) === JSON.stringify(apiBandTitles);

  const { bandDiffs, isAllBandsPass } = computeBandDiffs(domBands, apiBands);

  return {
    timestamp: new Date().toISOString(),
    isPass: isBandOrderMatch && isAllBandsPass,
    isBandOrderMatch,
    domBandTitles,
    apiBandTitles,
    bandDiffs
  };
}

function persistReport(report: LayoutIntegrityReport) {
  try {
    const stored = sessionStorage.getItem("__ytsua_layout_checks");
    const history: LayoutIntegrityReport[] = stored ? (JSON.parse(stored) as LayoutIntegrityReport[]) : [];
    history.push(report);
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    sessionStorage.setItem("__ytsua_layout_checks", JSON.stringify(history));
  } catch {}
}

function logReport(report: LayoutIntegrityReport) {
  const statusLabel = report.isPass ? "PASS" : "FAIL";
  console.group(`[YTSUA] Layout Integrity ${statusLabel} — ${report.timestamp}`);

  if (!report.isBandOrderMatch) {
    console.warn("Band order MISMATCH");
    console.log("DOM:", report.domBandTitles);
    console.log("API:", report.apiBandTitles);
  } else {
    console.log("Band order OK:", report.domBandTitles.join(" -> "));
  }

  for (const diff of report.bandDiffs) {
    const isBandPass = diff.onlyInDom.length === 0 && diff.onlyInApi.length === 0 && diff.isOrderMatch;
    const bandLabel = isBandPass ? "OK" : "FAIL";
    console.group(`[${bandLabel}] "${diff.title}" DOM[${diff.domIndex}] — DOM ${diff.domVideoIds.length} ids vs API ${diff.apiVideoIds.length} ids`);

    if (diff.onlyInDom.length > 0) {
      console.warn("Only in DOM:", diff.onlyInDom);
    }
    if (diff.onlyInApi.length > 0) {
      console.warn("Only in API:", diff.onlyInApi);
    }
    if (!diff.isOrderMatch) {
      console.warn("Intra-band order MISMATCH");
      console.log("DOM order:", diff.domVideoIds);
      console.log("API order:", diff.apiVideoIds);
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

  const apiBands = captureApiBands(apiResult.snapshots, apiResult.sectionOrder);
  const report = buildReport(domBands, apiBands);
  logReport(report);
  return report;
}
