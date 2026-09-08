// The guide is the payload the sidebar is built from. Its subscriptions section lists every channel
// the viewer follows: a handful of entries inline and the rest behind the "Show more" expander.

export interface InnerTubeGuideChannelEntry {
  navigationEndpoint?: {
    browseEndpoint?: {
      browseId?: string;
      canonicalBaseUrl?: string;
    };
  };
}

export interface InnerTubeGuideResponse {
  items?: Array<{
    guideSubscriptionsSectionRenderer?: {
      items?: Array<{
        guideEntryRenderer?: InnerTubeGuideChannelEntry;
        guideCollapsibleEntryRenderer?: {
          expandableItems?: Array<{ guideEntryRenderer?: InnerTubeGuideChannelEntry }>;
        };
      }>;
    };
  }>;
}
