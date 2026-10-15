import { isAnimationsEnabled } from "../../settings-state";
import type { RelatedSectionData } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { videoIdFromLockup } from "../../utils/video-id";
import { isLockupViewModel } from "../../youtube-api/guards";
import { fetchVideoChannel } from "../../youtube-api/oembed";
import { isInViewport, nextFrame } from "../animations";
import { createRemovalGhosts, dissolveRemovalGhosts } from "../mirror/mirror-ghosts";
import { glideToRest, pinAtOffset } from "../mirror/mirror-glide";
import {
  readRelatedTiles,
  relatedChips,
  relatedLockupElements,
  relatedSectionContents,
  relatedSections,
  videoIdFromRelatedLockup
} from "./related-list";

// The related list is drawn afresh on every request, so a tile missing from one poll has not gone
// anywhere - it was simply not drawn again. A tile only becomes a candidate after several polls in a row
// without it, and is only removed once oEmbed confirms the video no longer exists. A video confirmed to
// still exist is trusted for a while before it may be asked about again, and asks are capped per poll.
//
// A removed video stays removed for as long as this video's page is open. Switching chips re-renders
// the list - "All" restores it from a copy cached on the chip - so the video is also cut from every chip
// cache, and any re-render that still brings it back is pruned before it paints.
//
// The removal itself is a FLIP: the leaving tile is cloned into a ghost that dissolves in place, the
// model splices the item out (the section re-renders synchronously and keeps every surviving node), and
// the survivors, inverted back to where they stood in the same task, glide up into the gap.

const ABSENT_POLLS_BEFORE_PROBE = 3;
const AVAILABLE_TRUST_MS = 10 * 60 * 1000;
const MAX_PROBES_PER_POLL = 2;

const RELATED_RESULTS_SELECTOR = "ytd-watch-next-secondary-results-renderer";

const absentPollsByVideoId = new Map<string, number>();
const availableUntilByVideoId = new Map<string, number>();
const deletedVideoIds = new Set<string>();
let restoreObserver: MutationObserver | null = null;

export function resetRelatedRemovalTracking() {
  absentPollsByVideoId.clear();
  availableUntilByVideoId.clear();
  deletedVideoIds.clear();
  restoreObserver?.disconnect();
  restoreObserver = null;
}

function collectProbeCandidates(freshVideoIds: Set<string>) {
  const candidates: string[] = [];
  for (const videoId of readRelatedTiles().keys()) {
    if (freshVideoIds.has(videoId)) {
      absentPollsByVideoId.delete(videoId);
      continue;
    }

    const absentPolls = (absentPollsByVideoId.get(videoId) ?? 0) + 1;
    absentPollsByVideoId.set(videoId, absentPolls);
    const isProbeDue = absentPolls >= ABSENT_POLLS_BEFORE_PROBE
      && (availableUntilByVideoId.get(videoId) ?? 0) <= Date.now();
    if (isProbeDue) {
      candidates.push(videoId);
    }
  }
  return candidates.slice(0, MAX_PROBES_PER_POLL);
}

async function probeDeletedVideoIds(candidates: string[]) {
  const verdicts = await Promise.all(
    candidates.map(async videoId => ({
      videoId,
      isAvailable: (await fetchVideoChannel(videoId)).isAvailable
    }))
  );
  const confirmedDeletions = new Set<string>();
  for (const { videoId, isAvailable } of verdicts) {
    absentPollsByVideoId.delete(videoId);

    if (isAvailable) {
      availableUntilByVideoId.set(videoId, Date.now() + AVAILABLE_TRUST_MS);
      continue;
    }

    confirmedDeletions.add(videoId);
  }
  return confirmedDeletions;
}

type SectionRemovalParams = Prettify<{
  elSection: PolymerElement;
  removedVideoIds: Set<string>;
}>;

type RemovedItemIndexesParams = Prettify<{
  contents: NonNullable<RelatedSectionData["contents"]>;
  removedVideoIds: Set<string>;
}>;

// Last first, so splicing one index never shifts the ones still to go.
function removedItemIndexes({ contents, removedVideoIds }: RemovedItemIndexesParams) {
  const indexes: number[] = [];
  for (const [iItem, { lockupViewModel }] of contents.entries()) {
    const videoId = isLockupViewModel(lockupViewModel) ? videoIdFromLockup(lockupViewModel) : null;
    if (videoId && removedVideoIds.has(videoId)) {
      indexes.unshift(iItem);
    }
  }
  return indexes;
}

function spliceRemovedItems({ elSection, removedVideoIds }: SectionRemovalParams) {
  for (const iItem of removedItemIndexes({
    contents: relatedSectionContents(elSection),
    removedVideoIds
  })) {
    elSection.splice("data.contents", iItem, 1);
  }
}

function cutFromChipCaches(removedVideoIds: Set<string>) {
  for (const elChip of relatedChips()) {
    const cachedContents = elChip.data.navigationEndpoint?.relatedChipCommand?.contents ?? [];
    for (const iItem of removedItemIndexes({
      contents: cachedContents,
      removedVideoIds
    })) {
      cachedContents.splice(iItem, 1);
    }
  }
}

function pruneRestoredDeletions() {
  for (const elSection of relatedSections()) {
    spliceRemovedItems({
      elSection,
      removedVideoIds: deletedVideoIds
    });
  }
}

function observeRestores() {
  const elResults = document.querySelector(RELATED_RESULTS_SELECTOR);
  if (restoreObserver || !elResults) {
    return;
  }

  restoreObserver = new MutationObserver(pruneRestoredDeletions);
  restoreObserver.observe(elResults, {
    childList: true,
    subtree: true
  });
}

function glideSurvivors(survivorRects: Map<HTMLElement, DOMRect>) {
  const elGliders: HTMLElement[] = [];
  for (const [elLockup, before] of survivorRects) {
    const after = elLockup.getBoundingClientRect();
    const isPinned = pinAtOffset({
      elGlider: elLockup,
      deltaX: before.left - after.left,
      deltaY: before.top - after.top
    });
    if (isPinned) {
      elGliders.push(elLockup);
    }
  }
  return elGliders;
}

function releaseGliders(elGliders: HTMLElement[]) {
  for (const elGlider of elGliders) {
    glideToRest(elGlider);
  }
}

async function removeFromSection({ elSection, removedVideoIds }: SectionRemovalParams) {
  const elLockups = relatedLockupElements(elSection);
  const elRemoved = elLockups.filter(elLockup => removedVideoIds.has(videoIdFromRelatedLockup(elLockup) ?? ""));
  const isAnimated = isAnimationsEnabled() && elRemoved.some(elLockup => isInViewport(elLockup));
  if (!isAnimated) {
    spliceRemovedItems({
      elSection,
      removedVideoIds
    });
    return;
  }

  const survivorRects = new Map(elLockups
    .filter(elLockup => !elRemoved.includes(elLockup))
    .map(elLockup => [elLockup, elLockup.getBoundingClientRect()]));
  const ghosts = createRemovalGhosts(elRemoved);
  spliceRemovedItems({
    elSection,
    removedVideoIds
  });
  const elGliders = glideSurvivors(survivorRects);
  await nextFrame();
  releaseGliders(elGliders);
  dissolveRemovalGhosts(ghosts);
}

export async function pruneDeletedRelated(freshVideoIds: Set<string>) {
  pruneRestoredDeletions();
  const removedVideoIds = await probeDeletedVideoIds(collectProbeCandidates(freshVideoIds));
  if (removedVideoIds.size === 0) {
    return;
  }

  for (const videoId of removedVideoIds) {
    deletedVideoIds.add(videoId);
  }
  // A list restored from a chip cache is that very array, so the live section goes first, through
  // Polymer: cutting the cache first would drop the item under the renderer and leave its tile painted.
  await Promise.all(
    relatedSections().map(elSection => removeFromSection({
      elSection,
      removedVideoIds
    }))
  );
  cutFromChipCaches(removedVideoIds);
  observeRestores();
}
