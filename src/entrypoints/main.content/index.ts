import {
  addVideoToDom,
  addVideosToGridDom,
  findShelfForSection,
  moveVideoToFront,
  readDomSnapshot,
  removeVideosFromDom,
  updateVideoInDom
} from "./dom";
import {
  deepArray,
  deepRecord,
  isOnSubscriptionsPage,
  isPolymerElement,
  isRecord,
  videoIdFromData
} from "./helpers";
import { isInnerTubeBrowseResponse, parseApiResponse, parseSecondsAgo } from "./parse";
import { type VideoSnapshot, type YouTubeInnertubeConfig, VideoStatus } from "./types";

declare global {
  const yt: { config_?: YouTubeInnertubeConfig } | undefined;
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  main() {
    let lastSnapshot = new Map<string, VideoSnapshot>();
    let isDomReady = false;
    let contentObserver: MutationObserver | null = null;
    let pendingApiSnapshots: VideoSnapshot[] | null = null;
    let pendingApiSnapshotsTime = 0;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let focusDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    function handleBrowseResponse(event: Event) {
      if (!isOnSubscriptionsPage() || !(event instanceof CustomEvent)) {
        return;
      }

      if (!isInnerTubeBrowseResponse(event.detail)) {
        return;
      }

      const snapshots = parseApiResponse(event.detail);
      if (snapshots.length === 0) {
        return;
      }

      pendingApiSnapshots = snapshots;
      pendingApiSnapshotsTime = Date.now();
      if (isDomReady) {
        void detectAndApplyChanges(snapshots);
      }
    }

    async function detectAndApplyChanges(freshSnapshots: VideoSnapshot[]) {
      const freshMap = new Map(freshSnapshots.map(video => [video.videoId, video]));

      const videoIdsToRemove: string[] = [];
      for (const [videoId] of lastSnapshot) {
        if (!freshMap.has(videoId)) {
          videoIdsToRemove.push(videoId);
        }
      }

      if (videoIdsToRemove.length > 0) {
        await removeVideosFromDom(videoIdsToRemove);
      }

      const currentDomIds = new Set<string>();
      for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
        if (!isPolymerElement(elItem)) {
          continue;
        }

        const videoId = videoIdFromData(elItem.data);
        if (videoId) {
          currentDomIds.add(videoId);
        }
      }

      if (currentDomIds.size === 0) {
        const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
        if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
          for (const item of deepArray(elGrid.data, "contents")) {
            const videoId = videoIdFromData(deepRecord(item, "richItemRenderer"));
            if (videoId) {
              currentDomIds.add(videoId);
            }
          }
        }
      }

      const videosToAdd: VideoSnapshot[] = [];
      for (const [videoId, fresh] of freshMap) {
        const previous = lastSnapshot.get(videoId);
        if (!previous) {
          if (!currentDomIds.has(videoId)) {
            videosToAdd.push(fresh);
          }
        } else if (previous.status === VideoStatus.Upcoming && fresh.status === VideoStatus.Live) {
          void moveVideoToFront(videoId, fresh);
        } else {
          const isTitleChanged = previous.title !== fresh.title;
          const isThumbnailChanged = previous.thumbnailUrl !== fresh.thumbnailUrl;
          const isStatusChanged = previous.status !== fresh.status;
          const isViewCountChanged = previous.viewCountText !== fresh.viewCountText;
          const isTimestampChanged = previous.publishedTimeText !== fresh.publishedTimeText;
          const isVisualChange = isTitleChanged || isThumbnailChanged || isStatusChanged;
          const isAnyChange = isVisualChange || isViewCountChanged || isTimestampChanged;
          if (isAnyChange) {
            void updateVideoInDom(videoId, fresh, isVisualChange);
          }
        }
      }

      const isLayoutChange = videoIdsToRemove.length > 0 || videosToAdd.length > 0;
      lastSnapshot = freshMap;

      const timeOrderedSnapshots = freshSnapshots.toSorted(
        (videoA, videoB) => parseSecondsAgo(videoA.publishedTimeText) - parseSecondsAgo(videoB.publishedTimeText)
      );

      const shelfVideos = videosToAdd.filter(video => !!findShelfForSection(video.sectionTitle));
      const gridVideos = videosToAdd.filter(video => !findShelfForSection(video.sectionTitle));
      for (const video of shelfVideos) {
        await addVideoToDom(video, timeOrderedSnapshots, lastSnapshot);
      }
      if (gridVideos.length > 0) {
        await addVideosToGridDom(gridVideos, timeOrderedSnapshots);
      }

      return isLayoutChange;
    }

    async function computeAuthorizationHeader() {
      const cookiePair = document.cookie
        .split("; ")
        .find(row => row.startsWith("SAPISID="));
      if (!cookiePair) {
        return null;
      }

      const sapisid = cookiePair.slice("SAPISID=".length);
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `${timestamp} ${sapisid} https://www.youtube.com`;
      const encoded = new TextEncoder().encode(message);
      const hashBuffer = await crypto.subtle.digest("SHA-1", encoded);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
      return `SAPISIDHASH ${timestamp}_${hashHex}`;
    }

    async function fetchFreshVideos() {
      if (!isOnSubscriptionsPage() || !isDomReady) {
        return false;
      }

      const config = yt?.config_;
      if (!config) {
        return false;
      }

      const { INNERTUBE_CONTEXT } = config;
      if (!INNERTUBE_CONTEXT) {
        return false;
      }

      const authorizationHeader = await computeAuthorizationHeader();
      if (!authorizationHeader) {
        return false;
      }

      const response = await fetch("https://www.youtube.com/youtubei/v1/browse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authorizationHeader,
          "X-YTSUA": "1"
        },
        body: JSON.stringify({
          context: INNERTUBE_CONTEXT,
          browseId: "FEsubscriptions"
        })
      }).catch(() => null);
      if (!response) {
        return false;
      }

      const browseData: unknown = await response.json().catch(() => null);
      if (!isInnerTubeBrowseResponse(browseData)) {
        return false;
      }

      const freshSnapshots = parseApiResponse(browseData);
      if (freshSnapshots.length === 0) {
        return false;
      }

      return detectAndApplyChanges(freshSnapshots);
    }

    function handleSubscriptionChange() {
      void fetchFreshVideos();
    }

    function restartPolling() {
      pollingTimer = setInterval(() => {
        void fetchFreshVideos();
      }, 5000);
    }

    function handlePageFocus() {
      if (document.hidden || !isOnSubscriptionsPage() || !isDomReady) {
        return;
      }

      if (focusDebounceTimer !== null) {
        clearTimeout(focusDebounceTimer);
      }

      focusDebounceTimer = setTimeout(() => {
        focusDebounceTimer = null;
        if (pollingTimer !== null) {
          clearInterval(pollingTimer);
          pollingTimer = null;
        }
        void fetchFreshVideos().then(() => restartPolling());
      }, 300);
    }

    function stopMonitoring() {
      removeEventListener("ytsua-browse-response", handleBrowseResponse);
      removeEventListener("ytsua-subscription-change", handleSubscriptionChange);
      document.removeEventListener("visibilitychange", handlePageFocus);
      broadcastChannel.onmessage = null;
      if (focusDebounceTimer !== null) {
        clearTimeout(focusDebounceTimer);
        focusDebounceTimer = null;
      }
      if (pollingTimer !== null) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }

      if (contentObserver !== null) {
        contentObserver.disconnect();
        contentObserver = null;
      }
    }

    const broadcastChannel = new BroadcastChannel("ytsua");

    function startMonitoring() {
      addEventListener("ytsua-browse-response", handleBrowseResponse);
      addEventListener("ytsua-subscription-change", handleSubscriptionChange);
      document.addEventListener("visibilitychange", handlePageFocus);
      broadcastChannel.onmessage = handleSubscriptionChange;
      restartPolling();
    }

    function applyDomBaseline() {
      isDomReady = true;
      lastSnapshot = readDomSnapshot();
      if (pendingApiSnapshots !== null) {
        void detectAndApplyChanges(pendingApiSnapshots);
        pendingApiSnapshots = null;
      }
    }

    function isDomContentReady() {
      const elShelf = document.querySelector<HTMLElement>("ytd-rich-shelf-renderer");
      if (elShelf) {
        const elItem = elShelf.querySelector<HTMLElement>("ytd-rich-item-renderer");
        if (elItem && isPolymerElement(elItem) && isRecord(elItem.data)) {
          return true;
        }
      }

      const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
      if (elGridContents) {
        for (const elChild of elGridContents.children) {
          if (elChild.tagName === "YTD-RICH-ITEM-RENDERER" && isPolymerElement(elChild) && isRecord(elChild.data)) {
            return true;
          }
        }
      }

      // Background tabs: virtual scroller pauses rendering, but Polymer data is populated
      const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
      if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
        const { contents } = elGrid.data;
        if (Array.isArray(contents) && contents.length > 0) {
          return true;
        }
      }

      const elGridItem = document.querySelector<HTMLElement>("ytd-grid-video-renderer");
      return !!(elGridItem && isPolymerElement(elGridItem) && isRecord(elGridItem.data));
    }

    function initializePage() {
      isDomReady = false;
      lastSnapshot.clear();
      if (Date.now() - pendingApiSnapshotsTime >= 5000) {
        pendingApiSnapshots = null;
      }

      if (isDomContentReady()) {
        applyDomBaseline();
        return;
      }

      contentObserver = new MutationObserver(() => {
        if (isDomContentReady()) {
          contentObserver?.disconnect();
          contentObserver = null;
          applyDomBaseline();
        }
      });
      contentObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    function handleNavigation() {
      stopMonitoring();
      if (isOnSubscriptionsPage()) {
        initializePage();
        startMonitoring();
      }
    }

    document.addEventListener("yt-navigate-finish", handleNavigation);
    handleNavigation();
  }
});
