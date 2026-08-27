// In-place text edits for the three renderer shapes YouTube emits:
// "lockup" (new lockupViewModel), "shorts" (shorts shelf lockup), "legacy" (videoRenderer).
// Each shape has two functions: `update*` writes text; `changing*` returns elements that will
// change so the dissolve wrapper knows what to animate.

export { collectLockupTextElements } from "./text-fields-lockup-elements";
export { applyLockupTextChanges, changingLockupTextElements } from "./text-fields-lockup-apply";
export {
  changingLegacyTextElements,
  changingShortsTextElements,
  readShortsRenderedText,
  updateLegacyRendererTextFields,
  updateShortsTextFields
} from "./text-fields-legacy";
