import { hasMetadataChange } from "../../diff/metadata-diff";
import type { LockupViewModel, RelatedChipData } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromLockup, videoIdFromWatchHref } from "../../utils/video-id";
import { isLockupViewModel, isRelatedChipData, isRelatedSectionData } from "../../youtube-api/guards";
import { parseLockupViewModel } from "../../youtube-api/parse-lockup";
import { isThumbnailChanged, isThumbnailUrlRotated } from "../rich-item";
import { isSwapHeldOffByHover } from "../update/apply-targeted";
import { applyWithDissolve } from "../update/dissolve";
import { mutateLockupViewModelInPlace } from "../update/lockup-mutate-in-place";
import { applyLockupTextChanges, changingLockupTextElements, collectLockupTextElements } from "../update/text-fields";
import { applyProgressBarUpdate, crossfadeChangedThumbnail, findThumbnailImg } from "../update/thumbnail";

// The related list beside (or below) the player. It is an item section whose model holds one lockup
// per video, rendered as bare yt-lockup-view-model elements with no data of their own, so a tile is
// paired with its model by the video its link opens. Mixes and playlists link with a list id and are
// left alone - they are not videos. A changed tile is patched in place exactly like a feed tile (text
// pulses, thumbnail crossfades) and its model lockup is updated to match, so YouTube re-rendering the
// list later paints the same current values.

const RELATED_SECTION_SELECTOR = "ytd-watch-next-secondary-results-renderer ytd-item-section-renderer";
const RELATED_LOCKUP_SELECTOR = ":scope > #contents > yt-lockup-view-model";
const CHIP_SELECTOR = "ytd-watch-next-secondary-results-renderer yt-chip-cloud-chip-renderer";
const SELECTED_CHIP_ATTRIBUTE = "selected";
const WATCH_LINK_SELECTOR = "a[href*='/watch?']";

interface RelatedTile {
  elSection: PolymerElement;
  elLockup: HTMLElement;
  lockup: LockupViewModel;
}

export function videoIdFromRelatedLockup(elLockup: Element) {
  return videoIdFromWatchHref(elLockup.querySelector<HTMLAnchorElement>(WATCH_LINK_SELECTOR)?.href);
}

export function relatedLockupElements(elSection: Element) {
  return [...elSection.querySelectorAll<HTMLElement>(RELATED_LOCKUP_SELECTOR)];
}

export function relatedSections() {
  return [...document.querySelectorAll(RELATED_SECTION_SELECTOR)].filter(isPolymerElement);
}

// The live model, read through the guard rather than a parse: the lockups are mutated in place.
export function relatedSectionContents(elSection: PolymerElement) {
  return isRelatedSectionData(elSection.data) ? elSection.data.contents ?? [] : [];
}

function modelLockupsByVideoId(elSection: PolymerElement) {
  const lockups = new Map<string, LockupViewModel>();
  for (const { lockupViewModel } of relatedSectionContents(elSection)) {
    if (!isLockupViewModel(lockupViewModel)) {
      continue;
    }

    const videoId = videoIdFromLockup(lockupViewModel);
    if (videoId) {
      lockups.set(videoId, lockupViewModel);
    }
  }
  return lockups;
}

export function readRelatedTiles() {
  const tiles = new Map<string, RelatedTile>();
  for (const elSection of relatedSections()) {
    const lockups = modelLockupsByVideoId(elSection);
    for (const elLockup of relatedLockupElements(elSection)) {
      const videoId = videoIdFromRelatedLockup(elLockup);
      const lockup = videoId ? lockups.get(videoId) : undefined;
      if (videoId && lockup) {
        tiles.set(videoId, {
          elSection,
          elLockup,
          lockup
        });
      }
    }
  }
  return tiles;
}

function isRelatedChip(element: Element): element is PolymerElement<RelatedChipData> {
  return isPolymerElement(element) && isRelatedChipData(element.data);
}

export function relatedChips() {
  return [...document.querySelectorAll(CHIP_SELECTOR)].filter(isRelatedChip);
}

// "All" restores the list the page loaded with and carries no token; any other chip names its own feed.
export function selectedRelatedChipToken() {
  const elChip = relatedChips().find(elCandidate => elCandidate.hasAttribute(SELECTED_CHIP_ATTRIBUTE));
  return elChip?.data.navigationEndpoint?.continuationCommand?.token ?? null;
}

type ApplyRelatedTileUpdateParams = Prettify<RelatedTile & {
  previous: Prettify<VideoSnapshot>;
  fresh: Prettify<VideoSnapshot>;
  incoming: Prettify<LockupViewModel>;
}>;

async function applyRelatedTileUpdate({ elLockup, lockup, previous, fresh, incoming }: ApplyRelatedTileUpdateParams) {
  const refs = collectLockupTextElements(elLockup);
  const textElements = changingLockupTextElements({
    refs,
    fresh
  });
  const thumbnailUrls = {
    previousUrl: previous.thumbnailUrl,
    freshUrl: fresh.thumbnailUrl,
    freshStatus: fresh.status
  };
  const isThumbnailQueryRotated = isThumbnailUrlRotated(thumbnailUrls);
  const elImg = isThumbnailChanged(thumbnailUrls) || isThumbnailQueryRotated ? findThumbnailImg(elLockup) : null;
  const isThumbnailSwapping = !!elImg && await crossfadeChangedThumbnail({
    elImg,
    previousUrl: previous.thumbnailUrl,
    freshUrl: fresh.thumbnailUrl,
    isSamePathRotation: isThumbnailQueryRotated
  });

  applyWithDissolve({
    elements: textElements,
    apply() {
      applyLockupTextChanges({
        refs,
        fresh
      });
      mutateLockupViewModelInPlace({
        existing: lockup,
        incoming,
        preserveContentImage: !isThumbnailSwapping
      });
    }
  });

  if (previous.watchProgressPercent !== fresh.watchProgressPercent) {
    applyProgressBarUpdate({
      elLockup,
      percent: fresh.watchProgressPercent
    });
  }
}

// A hovered tile is playing its inline preview; its update waits for the pointer to leave, and the next
// poll still sees the change because the model was left untouched.
export async function applyRelatedUpdates(freshSnapshots: Prettify<VideoSnapshot>[]) {
  const tiles = readRelatedTiles();
  const updates: Promise<void>[] = [];
  for (const fresh of freshSnapshots) {
    const tile = tiles.get(fresh.videoId);
    const incoming = isLockupViewModel(fresh.rawRenderer) ? fresh.rawRenderer : null;
    const previous = tile ? parseLockupViewModel({
      lockup: tile.lockup,
      sectionTitle: "",
      bandIndex: 0
    }) : null;
    const isUpdatable = !!tile && !!incoming && !!previous && hasMetadataChange({
      previous,
      fresh
    });
    if (!isUpdatable || isSwapHeldOffByHover({
      elItem: tile.elLockup,
      fresh,
      previous
    })) {
      continue;
    }

    updates.push(
      applyRelatedTileUpdate({
        ...tile,
        previous,
        fresh,
        incoming
      })
    );
  }
  await Promise.all(updates);
}
