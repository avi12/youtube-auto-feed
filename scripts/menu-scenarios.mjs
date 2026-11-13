// Drives the open-menu scenarios against the ytaf dev Edge over CDP and prints one verdict per scenario.
// Usage: node menu-scenarios.mjs [cdpPort]
const port = process.argv[2] ?? "9232";
const BASE_WIDTH = 1910;
const HEIGHT = 924;
const RESIZED_WIDTH = 1500;

const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
const page = targets.find(target => target.type === "page" && target.url.includes("/feed/subscriptions"));
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise(resolve => pending.set(id, resolve));
};
const evaluate = async expression => {
  const { result } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "eval failed");
  return result?.result?.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const setWidth = width => send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 0, mobile: false });

const HELPERS = `
  const tiles = () => [...document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')];
  const idOf = el => el?.data?.content?.lockupViewModel?.contentId ?? null;
  const tileOf = id => tiles().find(el => idOf(el) === id);
  const openDropdown = () => [...document.querySelectorAll('tp-yt-iron-dropdown')].find(d => d.opened);
  const rectOf = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
`;

async function closeMenus() {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(300);
}

// Drops the first Latest video so the next fetch re-inserts it and every tile after it shifts one slot.
async function dropFirstVideo() {
  return evaluate(`(async () => { ${HELPERS}
    scrollTo(0, 0);
    const elGrid = document.querySelector('ytd-rich-grid-renderer');
    const full = [...elGrid.data.contents];
    const i = full.findIndex(item => item?.richItemRenderer?.content?.lockupViewModel?.contentId);
    elGrid.set('data.contents', full.filter((_, j) => j !== i));
    await new Promise(r => setTimeout(r, 600));
    return tiles().slice(0, 3).map(idOf);
  })()`);
}

async function clickMenuOfTile(iTile) {
  const point = await evaluate(`(() => { ${HELPERS}
    const r = tiles()[${iTile}].querySelector('button').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: idOf(tiles()[${iTile}]) };
  })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  await sleep(500);
  return point.id;
}

// Settled menu position vs where YouTube's own refit puts it right now (the refit is idempotent with a live anchor).
async function verdict() {
  return evaluate(`(() => { ${HELPERS}
    const d = openDropdown();
    if (!d) return { opened: false };
    const settled = rectOf(d);
    d.refit();
    const fresh = rectOf(d);
    const anchorTile = d.positionTarget?.closest?.('ytd-rich-item-renderer');
    return { opened: true, settled, fresh, isExact: settled.join() === fresh.join(), anchorVideo: idOf(anchorTile), leftovers: { translate: d.style.translate, transition: d.style.transition } };
  })()`);
}

async function startSampling() {
  await evaluate(`(() => { ${HELPERS}
    const d = openDropdown();
    const video = idOf(d.positionTarget.closest('ytd-rich-item-renderer'));
    const probe = globalThis.__menuProbe = { glideStart: null, frames: [], done: false };
    const t0 = performance.now();
    (async () => {
      while (performance.now() - t0 < 4500) {
        await new Promise(r => requestAnimationFrame(r));
        if (probe.glideStart === null && d.style.translate) probe.glideStart = Math.round(performance.now() - t0);
        const b = tileOf(video)?.querySelector('button');
        probe.frames.push({ t: Math.round(performance.now() - t0), w: innerWidth, menu: rectOf(d), btn: b ? rectOf(b) : null });
      }
      probe.done = true;
    })();
    globalThis.__ytafDebug.fetchFreshVideos().catch(() => {});
  })()`);
}

async function finishSampling() {
  while (!(await evaluate("globalThis.__menuProbe.done"))) await sleep(100);
  const probe = await evaluate("globalThis.__menuProbe");
  // Horizontal gap between the menu and the nearer edge of its button, per frame: 0 means lined up with it.
  const gaps = probe.frames.filter(f => f.btn).map(f => Math.min(Math.abs(f.menu[0] - f.btn[0]), Math.abs(f.menu[2] - f.btn[2])));
  return { maxGap: Math.max(...gaps), framesOff: gaps.filter(gap => gap > 2).length, frames: probe.frames.length };
}

const results = {};
await setWidth(BASE_WIDTH);
await evaluate("globalThis.__ytafDebug.pausePolling()");
await sleep(2500);

// 1. Plain push: the middle tile's menu rides to the right edge (its alignment flips) with no resize.
await closeMenus();
await dropFirstVideo();
results.pushVideo = await clickMenuOfTile(1);
await startSampling();
results.push = { ...(await finishSampling()), ...(await verdict()) };

// 2. Same push with a resize 100ms into the glide.
await closeMenus();
await setWidth(BASE_WIDTH);
await sleep(500);
await dropFirstVideo();
await clickMenuOfTile(1);
await startSampling();
while (!(await evaluate("globalThis.__menuProbe.glideStart !== null"))) await sleep(5);
await sleep(100);
await setWidth(RESIZED_WIDTH);
results.resizeMidGlide = { ...(await finishSampling()), ...(await verdict()) };

// 3. A metadata write re-renders the menu's tile (stale anchor), then the window resizes.
await closeMenus();
await setWidth(BASE_WIDTH);
await sleep(500);
await clickMenuOfTile(1);
await evaluate(`(async () => { ${HELPERS}
  const tile = openDropdown().positionTarget.closest('ytd-rich-item-renderer');
  const data = tile.data;
  tile.set('data', { ...data, content: { ...data.content, lockupViewModel: structuredClone(data.content.lockupViewModel) } });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`);
results.staleAnchorBeforeResize = await evaluate(`(() => { ${HELPERS} return openDropdown().positionTarget.isConnected; })()`);
await setWidth(RESIZED_WIDTH);
await sleep(600);
results.staleAnchorResize = await evaluate(`(() => { ${HELPERS}
  const d = openDropdown();
  const tile = tiles()[1];
  return { menu: rectOf(d), btn: rectOf(tile.querySelector('button')) };
})()`);

await closeMenus();
await send("Emulation.clearDeviceMetricsOverride");
await evaluate("globalThis.__ytafDebug.resumePolling()");
console.log(JSON.stringify(results, null, 1));
socket.close();
