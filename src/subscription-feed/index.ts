// Public surface of the subscription-feed feature. Everything outside this folder (i.e. the WXT
// entrypoints under src/entrypoints/) only ever imports from here.

export { createSubscriptionMonitor } from "./polling";
