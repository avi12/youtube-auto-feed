import { isExtensionEnabled } from "../../settings-state";
import type { Prettify } from "../../types/prettify";
import { isIronDropdown, type IronDropdownElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isInViewport, nextFrame } from "../animations";
import { RICH_ITEM_SELECTOR, type RichItemElement } from "./mirror-constants";
import { glideToRest, isInGlide, pinAtOffset, waitForGlide } from "./mirror-glide";

// A tile's "More actions" menu is a fixed-position dropdown lined up with the tile's menu button when it
// opens, and its actions act on that tile's video. A feed write rebinds tiles in place, so once the video
// moves, the button the menu was lined up with shows another video (or is gone) and the menu would hang
// over the wrong tile. The menu's video is read when it opens; every write lines the menu up with that
// video's button again, or closes it when the video left the feed or the screen.
//
// YouTube refits the menu itself when the window resizes, against the button it was lined up with. Any
// re-render of the tile (a metadata update) replaces that button, so a resize would throw the menu to the
// corner; the menu is lined up with its video's live button on every resize too. A resize mid-glide moves
// the slot its tile is gliding to, so the menu drops its own glide and is refit to its moving button on
// every frame until the tile has settled.

type OpenMenu = Prettify<{
  elDropdown: IronDropdownElement;
  elAnchor: Element;
  elItem: RichItemElement;
  videoId: string;
  buttonLabel: string;
}>;

let openMenu: OpenMenu | null = null;
let isFollowingThroughResize = false;

function recordOpenedMenu(e: Event) {
  const [elDropdown] = e.composedPath();
  if (!isIronDropdown(elDropdown) || !elDropdown.positionTarget) {
    return;
  }

  const elAnchor = elDropdown.positionTarget;
  const elButton = elAnchor.matches("button") ? elAnchor : elAnchor.querySelector("button");
  const elItem = elButton?.closest<RichItemElement>(RICH_ITEM_SELECTOR);
  const videoId = elItem && videoIdFromData(elItem.data);
  const buttonLabel = elButton?.getAttribute("aria-label");
  if (!elItem || !videoId || !buttonLabel) {
    return;
  }

  openMenu = {
    elDropdown,
    elAnchor,
    elItem,
    videoId,
    buttonLabel
  };
}

// The dropdown is shared by every popup, so it is still this menu only while it is aligned where it was left.
// Switched off, the extension leaves the feed and its menus alone.
function trackedOpenMenu() {
  if (!openMenu || !isExtensionEnabled()) {
    return null;
  }

  const { elDropdown, elAnchor } = openMenu;
  return elDropdown.opened && elDropdown.positionTarget === elAnchor ? openMenu : null;
}

function distanceBetweenCenters(left: DOMRect, right: DOMRect) {
  return Math.hypot(
    left.left + left.width / 2 - (right.left + right.width / 2),
    left.top + left.height / 2 - (right.top + right.height / 2)
  );
}

type MenuTarget = Prettify<{
  elButton: HTMLElement;
  elItem: RichItemElement;
}>;

type FindMenuTargetParams = Prettify<{
  menu: OpenMenu;
  menuRect: DOMRect;
}>;

// The tile the menu was last lined up with, while it still shows the menu's video. A feed write rebinds tiles
// to other videos, and a video can sit in more than one band, so otherwise the copy beside the menu is taken.
function findMenuTarget({ menu, menuRect }: FindMenuTargetParams) {
  const { elItem, videoId, buttonLabel } = menu;
  const buttonSelector = `button[aria-label="${CSS.escape(buttonLabel)}"]`;
  const isItemShowingVideo = elItem.isConnected && videoIdFromData(elItem.data) === videoId;
  const elCandidates = isItemShowingVideo
    ? [elItem]
    : [...document.querySelectorAll<RichItemElement>(RICH_ITEM_SELECTOR)]
      .filter(elCandidate => videoIdFromData(elCandidate.data) === videoId);
  function distanceFromMenu({ elButton }: MenuTarget) {
    return distanceBetweenCenters(elButton.getBoundingClientRect(), menuRect);
  }

  const [nearest] = elCandidates
    .flatMap(elCandidate => [...elCandidate.querySelectorAll<HTMLElement>(buttonSelector)]
      .map(elButton => ({
        elButton,
        elItem: elCandidate
      })))
    .sort((left, right) => distanceFromMenu(left) - distanceFromMenu(right));
  return nearest ?? null;
}

type AtRestParams<TMeasured> = Prettify<{
  elItem: HTMLElement;
  measure: () => TMeasured;
}>;

// A tile pinned for its glide still stands at its old slot; this measures it where it comes to rest.
function atRest<TMeasured>({ elItem, measure }: AtRestParams<TMeasured>) {
  const pinnedTranslate = elItem.style.translate;
  elItem.style.translate = "";
  const measured = measure();
  elItem.style.translate = pinnedTranslate;
  return measured;
}

type LineUpMenuParams = Prettify<{
  menu: OpenMenu;
  target: MenuTarget;
}>;

function lineUpMenu({ menu, target }: LineUpMenuParams) {
  const { elDropdown } = menu;
  const { elButton, elItem } = target;
  // The refit offsets the menu's own glide, so a glide left in flight would carry it off the button.
  elDropdown.style.transition = "";
  elDropdown.style.translate = "";
  elDropdown.positionTarget = elButton;
  elDropdown.refit();
  openMenu = {
    ...menu,
    elAnchor: elButton,
    elItem
  };
}

// Returns how far the menu jumped to reach its video's button, and whether its tile is about to glide there.
function followMenuVideo() {
  const menu = trackedOpenMenu();
  if (!menu) {
    return null;
  }

  const { elDropdown } = menu;
  const menuRect = elDropdown.getBoundingClientRect();
  const target = findMenuTarget({
    menu,
    menuRect
  });
  const isOnScreen = !!target && atRest({
    elItem: target.elItem,
    measure: () => isInViewport(target.elButton)
  });
  if (!target || !isOnScreen) {
    elDropdown.close();
    return null;
  }

  atRest({
    elItem: target.elItem,
    measure: () => lineUpMenu({
      menu,
      target
    })
  });
  const realignedRect = elDropdown.getBoundingClientRect();
  return {
    elDropdown,
    isTilePinned: target.elItem.style.translate !== "",
    deltaX: menuRect.left - realignedRect.left,
    deltaY: menuRect.top - realignedRect.top
  };
}

// Lines the menu up with its video's button where it stands now, unless a glide is carrying it there.
function reanchorOpenMenu() {
  const menu = trackedOpenMenu();
  if (!menu || isInGlide(menu.elDropdown)) {
    return;
  }

  const target = findMenuTarget({
    menu,
    menuRect: menu.elDropdown.getBoundingClientRect()
  });
  if (!target) {
    return;
  }

  lineUpMenu({
    menu,
    target
  });
}

async function followMenuThroughResize({ elDropdown, elItem }: OpenMenu) {
  isFollowingThroughResize = true;
  elDropdown.style.transition = "";
  elDropdown.style.translate = "";
  try {
    while (isInGlide(elItem) && trackedOpenMenu()) {
      elDropdown.refit();
      await nextFrame();
    }
  } finally {
    isFollowingThroughResize = false;
  }

  reanchorOpenMenu();
}

function handleResize() {
  const menu = trackedOpenMenu();
  if (!menu || isFollowingThroughResize) {
    return;
  }

  if (isInGlide(menu.elDropdown)) {
    followMenuThroughResize(menu).catch(() => {});
    return;
  }

  reanchorOpenMenu();
}

export function startOpenMenuTracking() {
  document.addEventListener("iron-overlay-opened", recordOpenedMenu, true);
  addEventListener("resize", handleResize);
}

export function alignOpenMenuToItsVideo() {
  followMenuVideo();
}

// Stands the menu back where it was, so it glides along with its tile on release; a tile that jumps (one
// outside the glide zone, or a shelf pushed down) takes its menu with it at once.
export function pinOpenMenuToItsVideo() {
  const followed = followMenuVideo();
  if (!followed?.isTilePinned) {
    return;
  }

  const { elDropdown, deltaX, deltaY } = followed;
  pinAtOffset({
    elGlider: elDropdown,
    deltaX,
    deltaY
  });
}

// A resize during the glide refits the menu against its moving tile, so it is lined up once more at rest.
export async function releaseOpenMenu() {
  const elDropdown = openMenu?.elDropdown;
  if (!elDropdown?.style.translate) {
    return;
  }

  glideToRest(elDropdown);

  if (await waitForGlide(elDropdown)) {
    reanchorOpenMenu();
  }
}
