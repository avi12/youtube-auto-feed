import { feedMessenger } from "@/shared/feed-messaging";
import { startOpenMenuTracking } from "@/subscription-feed/dom/mirror/mirror-open-menu";
import { startNewBadgeDismissal } from "@/subscription-feed/dom/new-badge/new-badge";
import { startThumbnailHealer } from "@/subscription-feed/dom/update/thumbnail";

import { installDevBridge } from "./dev-bridge";
import { createApplyHandlers } from "./polling-apply";
import { createBaselineHandlers } from "./polling-baseline";
import { createFetchHandlers } from "./polling-fetch";
import { createGenericPageHandlers } from "./polling-generic";
import { createLifecycleHandlers } from "./polling-lifecycle";
import { createScheduleHandlers } from "./polling-schedule";
import { createMonitorState, type MonitorContext } from "./polling-state";
import { createVideoPageHandlers } from "./polling-video";

export function createSubscriptionMonitor() {
  const state = createMonitorState();
  const deps = { state, getContext: () => context };
  const context: MonitorContext = {
    state,
    ...createApplyHandlers(deps),
    ...createFetchHandlers(deps),
    ...createScheduleHandlers(deps),
    ...createBaselineHandlers(deps),
    ...createGenericPageHandlers(deps),
    ...createVideoPageHandlers(deps),
    ...createLifecycleHandlers(deps)
  };
  startThumbnailHealer();
  startNewBadgeDismissal();
  startOpenMenuTracking();
  installDevBridge(context);

  feedMessenger.onMessage("browseResponse", ({ data }) => context.handleBrowseResponse(data));
  feedMessenger.onMessage("subscriptionChange", context.handleSubscriptionChange);

  return {
    handleNavigation: context.handleNavigation,
    setEnabled: context.setEnabled,
    syncVideoPageMonitor: context.syncVideoPageMonitor
  };
}
