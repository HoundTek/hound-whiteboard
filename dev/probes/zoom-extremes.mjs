/**
 * @file 缩放两端的代价
 * @description 测量不同缩放档位下的加载区块数、收集耗时与整帧耗时，用于确定缩放上下限。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../../src/kernel/board/board-core.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";
import { StrokeObject } from "../../src/kernel/objects/stroke/stroke.js";
import { Vector } from "../../src/kernel/utils/math.js";

const W = 900, H = 700, STROKES = 600;
const origOff = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    const c = createCanvas(w, h);
    c.transferToImageBitmap = () => { const s = createCanvas(w, h); s.getContext("2d").drawImage(c, 0, 0); return s; };
    return c;
  }
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

/**
 * 建立场景并测量单个缩放档位
 * @param {number} zoom - 目标缩放
 * @returns {Promise<Object>} 测量结果
 */
async function measure(zoom) {
  const boardCore = new BoardCore({ width: 1024, height: 1024 });
  const viewport = new ViewportCore({ boardCore, viewportId: `zx-${zoom}`, width: W, height: H, postRenderFrame() {}, tiles: true });
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
  await new Promise((r) => setTimeout(r, 150));
  viewport.flushRenderFrame();

  const t0 = performance.now();
  viewport.onViewportChange({ origin: { x: 100, y: 0 }, zoom });
  viewport.flushRenderFrame();
  const frameMs = performance.now() - t0;

  const t1 = performance.now();
  const drawables = renderer.collectStaticDrawables();
  const collectMs = performance.now() - t1;
  const result = {
    zoom,
    chunks: viewport.chunkLoader.getLoadedChunks().length,
    objects: drawables.length,
    collectMs,
    frameMs,
  };
  viewport.destroy?.();
  return result;
}

console.log("缩放 | 已载区块 | 收集对象 | 收集耗时 | 稳定后一帧");
for (const z of [0.1, 0.05, 0.02, 5, 16, 32, 64, 128]) {
  const r = await measure(z);
  console.log(
    `${String(r.zoom).padStart(5)} | ${String(r.chunks).padStart(8)} | ${String(r.objects).padStart(8)} | ${r.collectMs.toFixed(2).padStart(8)}ms | ${r.frameMs.toFixed(2).padStart(10)}ms`,
  );
}
globalThis.OffscreenCanvas = origOff;
process.exit(0);
