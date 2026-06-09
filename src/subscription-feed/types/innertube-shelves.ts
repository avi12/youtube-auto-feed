import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "./innertube-renderers";

// Shelf / grid envelopes that contain one or more of the video renderer variants.

export interface InnerTubeRichItemContent {
  videoRenderer?: InnerTubeVideoRenderer;
  gridVideoRenderer?: InnerTubeVideoRenderer;
  richGridMediaRenderer?: {
    content?: { videoRenderer?: InnerTubeVideoRenderer };
  };
  lockupViewModel?: LockupViewModel;
  shortsLockupViewModel?: ShortsLockupViewModel;
}

export interface InnerTubeRichShelfRenderer {
  title: { runs: Array<{ text: string }> };
  contents: Array<{
    richItemRenderer?: { content: InnerTubeRichItemContent };
  }>;
}

export interface InnerTubeShelfRenderer {
  title: { runs: Array<{ text: string }> };
  content: {
    horizontalListRenderer?: {
      items: Array<{
        videoRenderer?: InnerTubeVideoRenderer;
        gridVideoRenderer?: InnerTubeVideoRenderer;
      }>;
    };
    gridRenderer?: {
      items: Array<{
        videoRenderer?: InnerTubeVideoRenderer;
        gridVideoRenderer?: InnerTubeVideoRenderer;
      }>;
    };
  };
}

export interface InnerTubeContinuationItem {
  trigger: string;
  continuationEndpoint: {
    clickTrackingParams: string;
    commandMetadata?: {
      webCommandMetadata?: {
        sendPost?: boolean;
        apiUrl?: string;
      };
    };
    continuationCommand: {
      token: string;
      request: string;
    };
  };
  ghostCards?: {
    ghostGridRenderer?: { rows: number };
  };
}

export interface InnerTubeRichGridItem {
  richSectionRenderer?: {
    content: {
      richShelfRenderer?: InnerTubeRichShelfRenderer;
      shelfRenderer?: InnerTubeShelfRenderer;
    };
    trackingParams?: string;
  };
  richItemRenderer?: {
    content: InnerTubeRichItemContent;
    trackingParams?: string;
    onFocusEffect?: unknown;
    rowIndex?: number;
    colIndex?: number;
  };
  continuationItemRenderer?: InnerTubeContinuationItem;
}

export interface InnerTubeBrowseResponse {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: Array<{
        tabRenderer: {
          content: {
            richGridRenderer?: { contents: InnerTubeRichGridItem[] };
            sectionListRenderer?: { contents: Array<{
              itemSectionRenderer?: { contents: Array<{ shelfRenderer?: InnerTubeShelfRenderer }> };
            }>; };
          };
        };
      }>;
    };
  };
}
