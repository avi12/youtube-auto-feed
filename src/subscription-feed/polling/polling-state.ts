import { type BandLayout, captureBandLayout } from "../dom/band/band-layout";
import { readDomSnapshot } from "../dom/query/query";
import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";

export interface FeedPayload {
  snapshots: VideoSnapshot[];
  sectionOrder: string[];
  apiContents: InnerTubeRichGridItem[];
}

export type ApplyChangesParams = Prettify<{
  payload: Prettify<FeedPayload>;
  isInitialLoad?: boolean;
}>;

export const INITIAL_POLL_DELAY_MS = 10 * 1000;
export const POLL_INTERVAL_MS = 5 * 1000;
export const METADATA_POLL_INTERVAL_MS = 10 * 1000;
export const PENDING_SNAPSHOT_STALE_MS = 5000;
export const ORPHAN_CLEANUP_INTERVAL_MS = 5000;

export interface MonitorState {
  lastSnapshot: Map<string, Prettify<VideoSnapshot>>;
  isDomReady: boolean;
  isEnabled: boolean;
  isApplyingChanges: boolean;
  contentObserver: MutationObserver | null;
  orphanCleanupTimer: ReturnType<typeof setInterval> | null;
  pendingApiSnapshots: Prettify<FeedPayload> | null;
  pendingApiSnapshotsTime: number;
  pollingDelayTimer: ReturnType<typeof setTimeout> | null;
  pollingTimer: ReturnType<typeof setInterval> | null;
  pageLoadTime: number;
  metadataPollingTimer: ReturnType<typeof setInterval> | null;
  cancelBroadcastListener: (() => void) | null;
  initialBandLayout: Prettify<BandLayout> | null;
  isSubscriptionFetchInProgress: boolean;
  thumbnailContentHashes: Map<string, string>;
  lastThumbnailWatchTime: number;
}

export function createMonitorState(): MonitorState {
  return {
    lastSnapshot: new Map(),
    isDomReady: false,
    isEnabled: true,
    isApplyingChanges: false,
    contentObserver: null,
    orphanCleanupTimer: null,
    pendingApiSnapshots: null,
    pendingApiSnapshotsTime: 0,
    pollingDelayTimer: null,
    pollingTimer: null,
    pageLoadTime: 0,
    metadataPollingTimer: null,
    cancelBroadcastListener: null,
    initialBandLayout: null,
    isSubscriptionFetchInProgress: false,
    thumbnailContentHashes: new Map(),
    lastThumbnailWatchTime: 0
  };
}

export interface MonitorContext {
  state: MonitorState;
  applyChanges: (params: ApplyChangesParams) => Promise<boolean>;
  fetchFreshVideos: (isInitialLoad?: boolean) => Promise<boolean>;
  fetchAndApplyMetadataUpdates: () => Promise<void>;
  handleBrowseResponse: (response: unknown) => void;
  handleSubscriptionChange: () => void;
  clearPolling: () => void;
  restartPolling: () => void;
  handlePageFocus: () => void;
  pausePolling: () => void;
  resumePolling: () => void;
  startMonitoring: () => void;
  stopMonitoring: () => void;
  applyDomBaseline: () => Promise<void>;
  initializePage: () => void;
  handleNavigation: () => void;
  setEnabled: (enabled: boolean) => void;
}

export function rebuildBaselineFromDom(state: MonitorState, trimmedVideoIds: Iterable<string>) {
  state.lastSnapshot = readDomSnapshot();
  for (const videoId of trimmedVideoIds) {
    state.lastSnapshot.delete(videoId);
  }
  state.initialBandLayout = captureBandLayout();
}

export function preloadSnapshotThumbnails(snapshots: VideoSnapshot[]) {
  for (const { thumbnailUrl } of snapshots) {
    if (!thumbnailUrl) {
      continue;
    }

    const img = new Image();
    img.src = thumbnailUrl;
  }
}
