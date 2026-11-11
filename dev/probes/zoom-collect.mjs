/**
 * @file 缩小方向的成本归属
 * @description 分离「收集已载区块对象」与「光栅化对象」在深缩放下的耗时占比。
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

const boardCore = new BoardCore({ width: W, height: H });
boardCore.width = W; boardCore.height = H;
const viewport = new ViewportCore({ boardCore, viewportId: "zc", width: W, height: H, postRenderFrame() {}, tiles: true });
viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: 1, viewportSize: { width: W, height: H }, force: true });
await new Promise((r) => setTimeout(r, 120));
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

let resolveCalls = 0;
/**
 * 现状实现：每个对象都重建一次候选区块 id 数组
 * @param {Iterable<*>} chunks - 已载区块
 * @param {string} objectId - 对象 id
 * @returns {Object|undefined} 对象实例
 */
const currentResolve = (chunks, objectId) => {
  resolveCalls++;
  const loadedChunks = Array.from(chunks).filter(Boolean);
  const candidateChunkIds = loadedChunks
    .map((chunk) => chunk?.id)
    .filter((chunkId) => Number.isInteger(chunkId));
  const objectInstance =
    renderer.viewport?.board?.activeObjectManager?.findBoardObjectInstance?.(
      objectId,
      candidateChunkIds,
    ) ?? renderer.viewport?.board?.getObjectById?.(objectId);
  return objectInstance;
};
renderer.resolveStaticObjectFromChunks = currentResolve;

/**
 * 试验实现：区块 id 数组对整次收集只需要算一次（实际上被调方根本不读它）
 * @param {Iterable<*>} _chunks - 已载区块（未使用）
 * @param {string} objectId - 对象 id
 * @returns {Object|undefined} 对象实例
 */
const hoistedResolve = (_chunks, objectId) => {
  resolveCalls++;
  const objectInstance =
    renderer.viewport?.board?.activeObjectManager?.findBoardObjectInstance?.(
      objectId,
    ) ?? renderer.viewport?.board?.getObjectById?.(objectId);
  return objectInstance;
};
console.log("目标 zoom | 已载区块 | 收集(现状) | 收集(提升后) | 收集到对象");
for (const z of [1, 1 / 2, 1 / 8, 1 / 32, 1 / 64]) {
  const t0 = performance.now();
  viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: z, viewportSize: { width: W, height: H } });
  viewport.flushRenderFrame();
  const frameMs = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 80));
  viewport.flushRenderFrame();

  const chunks = viewport.chunkLoader.getLoadedChunks().length;

  renderer.resolveStaticObjectFromChunks = currentResolve;
  resolveCalls = 0;
  let t1 = performance.now();
  const drawablesNow = renderer.collectStaticDrawables();
  const collectNow = performance.now() - t1;

  renderer.resolveStaticObjectFromChunks = hoistedResolve;
  resolveCalls = 0;
  t1 = performance.now();
  const drawablesHoisted = renderer.collectStaticDrawables();
  const collectHoisted = performance.now() - t1;

  // 两种实现必须收集到同一批对象
  const same =
    drawablesNow.length === drawablesHoisted.length &&
    drawablesNow.every((obj, i) => obj === drawablesHoisted[i]);

  console.log(
    `${String(z.toFixed(4)).padStart(9)} | ${String(chunks).padStart(8)} | ${collectNow.toFixed(2).padStart(9)}ms | ${collectHoisted.toFixed(3).padStart(11)}ms | ${String(drawablesNow.length).padStart(10)} 一致=${same} 首帧=${frameMs.toFixed(1)}ms`,
  );
}
globalThis.OffscreenCanvas = origOff;
process.exit(0);
