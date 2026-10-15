import { feedMessenger } from "../../shared/feed-messaging";
import { startOpenMenuTracking } from "../dom/mirror/mirror-open-menu";
import { startNewBadgeDismissal } from "../dom/new-badge/new-badge";
import { startThumbnailHealer } from "../dom/update/thumbnail";
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
  const context = { state: createMonitorState() } as MonitorContext;

  Object.assign(context, createApplyHandlers(context));
  Object.assign(context, createFetchHandlers(context));
  Object.assign(context, createScheduleHandlers(context));
  Object.assign(context, createBaselineHandlers(context));
  Object.assign(context, createGenericPageHandlers(context));
  Object.assign(context, createVideoPageHandlers(context));
  Object.assign(context, createLifecycleHandlers(context));
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
