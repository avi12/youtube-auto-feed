// InnerTube client config exposed on `ytcfg` (MAIN-world content scripts).

export {};

type InnerTubeClientName =
  | "WEB"
  | "MWEB"
  | "ANDROID"
  | "IOS"
  | "TVHTML5"
  | "TV_UNPLUGGED"
  | "WEB_EMBEDDED_PLAYER"
  | "WEB_CREATOR";

type InnerTubePlatform = "DESKTOP" | "MOBILE" | "TV";

type InnerTubeClientFormFactor =
  | "UNKNOWN_FORM_FACTOR"
  | "SMALL_FORM_FACTOR"
  | "LARGE_FORM_FACTOR"
  | "AUTOMOTIVE_FORM_FACTOR";

type InnerTubeUserInterfaceTheme =
  | "USER_INTERFACE_THEME_DARK"
  | "USER_INTERFACE_THEME_LIGHT";

interface InnerTubeContext {
  client: {
    clientName: InnerTubeClientName;
    clientVersion: string;
    hl?: string;
    gl?: string;
    remoteHost?: string;
    deviceMake?: string;
    deviceModel?: string;
    visitorData?: string;
    userAgent?: string;
    osName?: string;
    osVersion?: string;
    originalUrl?: string;
    platform?: InnerTubePlatform;
    clientFormFactor?: InnerTubeClientFormFactor;
    windowWidthPoints?: number;
    configInfo?: { appInstallData?: string };
    screenDensityFloat?: number;
    userInterfaceTheme?: InnerTubeUserInterfaceTheme;
    timeZone?: string;
    browserName?: string;
    browserVersion?: string;
    memoryTotalKbytes?: number;
    acceptHeader?: string;
    deviceExperimentId?: string;
    rolloutToken?: string;
  };
  user?: { lockedSafetyMode?: boolean };
  request?: { useSsl?: boolean };
  clickTracking?: { clickTrackingParams?: string };
}

interface YouTubeInnertubeConfig {
  INNERTUBE_CLIENT_VERSION?: string;
  INNERTUBE_CONTEXT?: InnerTubeContext;
  INNERTUBE_API_KEY?: string;
  HL?: string;
  GL?: string;
}

declare global {
  const ytcfg: { get<K extends keyof YouTubeInnertubeConfig>(key: K): YouTubeInnertubeConfig[K] } | undefined;
}
