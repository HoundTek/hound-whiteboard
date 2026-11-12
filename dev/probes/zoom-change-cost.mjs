/**
 * @file 缩放变更一帧的实际代价
 * @description 测量各档位下改变缩放时整片 tile 重建的耗时与块数，用于区分「回访」与「新倍率」两种成本。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";

globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    const c = createCanvas(w, h);
    c.transferToImageBitmap = () => {
      const s = createCanvas(w, h);
      s.getContext("2d").drawImage(c, 0, 0);
      return s;
    };
    return c;
  }
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const R = "../../src";
const { BoardCore } = await import(`${R}/kernel/board/board-core.js`);
const { ViewportCore } = await import(`${R}/renderers/canvas/viewport-core.js`);
const { StrokeObject } = await import(`${R}/kernel/objects/stroke/stroke.js`);
const { Vector } = await import(`${R}/kernel/utils/math.js`);

const W = 900, H = 700, STROKES = 600;

/**
 * 建立带笔迹的视口
 * @param {number} dpr - 设备倍率
 * @param {number} zoom - 初始缩放
 * @returns {Promise<Object>} 视口上下文
 */
async function setup(dpr, zoom) {
  const boardCore = new BoardCore({ width: 1024, height: 1024 });
  const viewport = new ViewportCore({
    boardCore, viewportId: `zc-${dpr}-${zoom}`, width: W, height: H,
    postRenderFrame() {}, tiles: true, devicePixelRatio: dpr,
  });
  const renderer = viewport.renderer;
  const aom = boardCore.activeObjectManager;
  aom.renderHooks = {
    requestActiveRender(o = []) { renderer.invalidateActiveObjects(o); viewport.markFrameDirty(); },
    requestStaticRender(c = []) { renderer.invalidateChunks(c); viewport.markFrameDirty(); },
    requestStaticRenderForObjects(o = [], c = [], p) { renderer.invalidateCachedObjects(o, { previousWorldRects: p }); viewport.markFrameDirty(); },
    requestViewportRender() { viewport.markFrameDirty(); },
  };
  for (let i = 0; i < STROKES; i++) {
    const points = [];
    for (let k = 0; k < 30; k++) points.push({ x: k * 3, y: Math.sin(k) * 18 });
    const stroke = new StrokeObject(i + 1, new Vector((i % 22) * 40, Math.floor(i / 22) * 40), { color: "#222", width: 3 }, { points });
    boardCore.registerObjectInstance(stroke);
    aom.add([stroke]);
    aom.apply([stroke]);
  }
  viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom, viewportSize: { width: W, height: H }, force: true });
  viewport.flushRenderFrame();
  await new Promise((r) => setTimeout(r, 300));
  viewport.flushRenderFrame();
  return { viewport, renderer };
}

console.log("缩放 | DPR | 新倍率一帧 | 重建块数 | 回到原倍率重建块数");
for (const zoom of [1, 0.25, 0.05]) {
  for (const dpr of [1, 2]) {
    const { viewport, renderer } = await setup(dpr, zoom);
    const info = renderer.getTileDebugInfo();

    // 1) 换到一个新倍率（缩小 10%）：必须整片重建
    const before = info.rebuildCount;
    const t0 = performance.now();
    viewport.onViewportChange({ origin: viewport.origin, zoom: zoom * 0.9 });
    viewport.flushRenderFrame();
    const changeMs = performance.now() - t0;
    const changeRebuilds = renderer.getTileDebugInfo().rebuildCount - before;

    // 2) 回到原倍率：等预览提交后再量，提交帧才是真实的重建成本
    const before2 = renderer.getTileDebugInfo().rebuildCount;
    viewport.onViewportChange({ origin: viewport.origin, zoom });
    viewport.flushRenderFrame();
    await new Promise((r) => setTimeout(r, 250));
    viewport.flushRenderFrame();
    const backRebuilds = renderer.getTileDebugInfo().rebuildCount - before2;

    console.log(
      `${String(zoom).padStart(4)} | ${String(dpr).padStart(3)} | ${changeMs.toFixed(2).padStart(9)}ms | ${String(changeRebuilds).padStart(8)} | ${String(backRebuilds).padStart(8)}`,
    );
    viewport.destroy?.();
  }
}
process.exit(0);
