/**
 * @file tile 边长与外扩的取舍
 * @description 扫描块边长与缓存外扩比例，同时量内存、平移帧、局部提交与整片重建，用于定常量。
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

const W = 900, H = 700, STROKES = 300, DPR = 2;

/**
 * 建场景
 * @param {Object} options - tile 配置
 * @returns {Promise<Object>} 场景
 */
async function setup(options) {
  const boardCore = new BoardCore({ width: 1024, height: 1024 });
  const viewport = new ViewportCore({
    boardCore, viewportId: `tw-${options.tileSize}-${options.tileCacheMargin}`,
    width: W, height: H, postRenderFrame() {}, tiles: true, devicePixelRatio: DPR,
    ...options,
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
  const objects = [];
  for (let i = 0; i < STROKES; i++) {
    const points = [];
    for (let k = 0; k < 30; k++) points.push({ x: k * 3, y: Math.sin(k) * 18 });
    const s = new StrokeObject(i + 1, new Vector((i % 22) * 40, Math.floor(i / 22) * 40), { color: "#222", width: 3 }, { points });
    boardCore.registerObjectInstance(s); aom.add([s]); aom.apply([s]);
    objects.push(s);
  }
  viewport.flushRenderFrame();
  await new Promise((r) => setTimeout(r, 150));
  viewport.flushRenderFrame();
  return { boardCore, viewport, renderer, aom, objects };
}

console.log("块边长 | 外扩 | 块数 | 内存(DPR2) | 平移 | 单笔提交 | 整片重建");
for (const tileSize of [256, 384, 512, 1024]) {
  for (const margin of [0.05, 0.1, 0.2]) {
    const { viewport, renderer, aom, objects } = await setup({ tileSize, tileCacheMargin: margin });
    const info = renderer.getTileDebugInfo();

    // 平移：无重建
    const t0 = performance.now();
    viewport.onViewportChange({ origin: { x: viewport.origin.x + 20, y: viewport.origin.y }, zoom: 1 });
    viewport.flushRenderFrame();
    const panMs = performance.now() - t0;

    // 单笔提交：只脏一笔的世界范围
    const target = objects[10];
    const worldRect = renderer.getObjectWorldRect(target);
    const t1 = performance.now();
    renderer.invalidateCachedObjects([target], { previousWorldRects: new Map() });
    viewport.flushRenderFrame();
    const commitMs = performance.now() - t1;

    // 整片重建：全部 tile 标脏
    const store = renderer.getTileStoreForProbe?.();
    const t2 = performance.now();
    renderer.invalidateViewport();
    viewport.flushRenderFrame();
    const fullMs = performance.now() - t2;

    console.log(
      `${String(tileSize).padStart(6)} | ${String(margin).padStart(4)} | ${String(info.tileCount).padStart(4)} | ${(info.bytes / 1024 / 1024).toFixed(1).padStart(8)}MB | ${panMs.toFixed(2).padStart(5)}ms | ${commitMs.toFixed(2).padStart(7)}ms | ${fullMs.toFixed(2).padStart(8)}ms`,
    );
    void target; void worldRect; void store; void aom;
    viewport.destroy?.();
  }
}
process.exit(0);
