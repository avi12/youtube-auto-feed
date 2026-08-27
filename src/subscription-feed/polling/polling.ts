import { feedMessenger } from "../../shared/feed-messaging";
import { startThumbnailHealer } from "../dom/update/thumbnail";
import { installDevBridge } from "./dev-bridge";
import { createApplyHandlers } from "./polling-apply";
import { createBaselineHandlers } from "./polling-baseline";
import { createFetchHandlers } from "./polling-fetch";
import { createGenericPageHandlers } from "./polling-generic";
import { createLifecycleHandlers } from "./polling-lifecycle";
import { createScheduleHandlers } from "./polling-schedule";
import { createMonitorState, type MonitorContext } from "./polling-state";

export function createSubscriptionMonitor() {
  const context = { state: createMonitorState() } as MonitorContext;

  Object.assign(context, createApplyHandlers(context));
  Object.assign(context, createFetchHandlers(context));
  Object.assign(context, createScheduleHandlers(context));
  Object.assign(context, createBaselineHandlers(context));
  Object.assign(context, createGenericPageHandlers(context));
  Object.assign(context, createLifecycleHandlers(context));
  startThumbnailHealer();
  installDevBridge(context);

  feedMessenger.onMessage("browseResponse", ({ data }) => context.handleBrowseResponse(data));
  feedMessenger.onMessage("subscriptionChange", context.handleSubscriptionChange);

  return {
    handleNavigation: context.handleNavigation,
    setEnabled: context.setEnabled
  };
}
