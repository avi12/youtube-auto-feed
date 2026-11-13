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
  title: { runs: { text: string }[] };
  contents: {
    richItemRenderer?: { content: InnerTubeRichItemContent };
  }[];
}

export interface InnerTubeShelfRenderer {
  title: { runs: { text: string }[] };
  content: {
    horizontalListRenderer?: {
      items: {
        videoRenderer?: InnerTubeVideoRenderer;
        gridVideoRenderer?: InnerTubeVideoRenderer;
      }[];
    };
    gridRenderer?: {
      items: {
        videoRenderer?: InnerTubeVideoRenderer;
        gridVideoRenderer?: InnerTubeVideoRenderer;
      }[];
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
    // Set by YouTube Semi-Subscribe on the videos it lists from channels the viewer is not subscribed to
    yssSemiSubscribed?: boolean;
    onFocusEffect?: unknown;
    rowIndex?: number;
    colIndex?: number;
  };
  continuationItemRenderer?: InnerTubeContinuationItem;
}

export interface InnerTubeBrowseResponse {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: {
        tabRenderer: {
          content: {
            richGridRenderer?: {
              contents: InnerTubeRichGridItem[];
              // Set by YouTube Semi-Subscribe: the videos it hides, left out of the contents
              yssHiddenVideoIds?: string[];
            };
            sectionListRenderer?: {
              contents: {
                itemSectionRenderer?: { contents: Array<{ shelfRenderer?: InnerTubeShelfRenderer }> };
              }[];
            };
          };
        };
      }[];
    };
  };
}
