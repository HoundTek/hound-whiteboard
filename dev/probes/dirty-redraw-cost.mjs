/**
 * @file 局部脏区重绘的对象迭代成本
 * @description 在不同缩放下测量把一小块脏区重绘一遍的耗时，区分像素面积成本与对象数成本。
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

const { BoardCore } = await import("../../src/kernel/board/board-core.js");
const { ViewportCore } = await import("../../src/renderers/canvas/viewport-core.js");
const { StrokeObject } = await import("../../src/kernel/objects/stroke/stroke.js");
const { Vector } = await import("../../src/kernel/utils/math.js");
const { RectangleRange } = await import("../../src/kernel/range/rectangle.js");

const W = 900, H = 700, STROKES = 600;

/**
 * 建一个视口并铺满笔迹
 * @param {number} zoom - 初始缩放
 * @returns {Promise<Object>} 视口与渲染器
 */
async function setup(zoom) {
  const boardCore = new BoardCore({ width: 1024, height: 1024 });
  const viewport = new ViewportCore({
    boardCore, viewportId: `dr-${zoom}`, width: W, height: H, postRenderFrame() {}, tiles: true,
  });
  viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: 1, viewportSize: { width: W, height: H }, force: true });
  await new Promise((r) => setTimeout(r, 60));
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
    const s = new StrokeObject(i + 1, new Vector((i % 22) * 40, Math.floor(i / 22) * 40), { color: "#222", width: 3 }, { points });
    boardCore.registerObjectInstance(s); aom.add([s]); aom.apply([s]);
  }
  viewport.flushRenderFrame();
  viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom, viewportSize: { width: W, height: H }, force: true });
  viewport.flushRenderFrame();
  await new Promise((r) => setTimeout(r, 200));
  viewport.flushRenderFrame();
  return { boardCore, viewport, renderer };
}

console.log("缩放 | 脏区边长(屏幕px) | 相交对象数 | 重绘耗时");
for (const zoom of [1, 0.2, 0.05]) {
  const { boardCore, viewport, renderer } = await setup(zoom);
  const aom = boardCore.activeObjectManager;
  const items = aom.collectStaticDrawables?.() ?? renderer.collectStaticDrawables();
  const entries = items.map((obj) => ({ objectId: obj.id, object: obj }));
  const ctx = createCanvas(W, H).getContext("2d");
  const viewportContext = renderer.createViewportContext(ctx, { zoom, origin: { x: 0, y: 0 } });

  for (const side of [4, 16, 64]) {
    const rect = new RectangleRange(300, 200, side, side);
    const worldRect = new RectangleRange(300 / zoom, 200 / zoom, side / zoom, side / zoom);
    const hits = entries.filter((entry) => {
      const r = renderer.getObjectWorldRect(entry.object);
      return r && !(r.right < worldRect.left || r.left > worldRect.right || r.bottom < worldRect.top || r.top > worldRect.bottom);
    }).length;
    let total = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      renderer.clearRegion(ctx, rect);
      renderer.renderRegion(ctx, viewportContext, entries, rect);
      total += performance.now() - t0;
    }
    console.log(
      `${String(zoom).padStart(5)} | ${String(side).padStart(16)} | ${String(hits).padStart(12)} | ${(total / 5).toFixed(2).padStart(8)}ms`,
    );
  }
  viewport.destroy?.();
}
process.exit(0);
