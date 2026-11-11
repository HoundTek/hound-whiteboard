/**
 * @file 平移时每帧的 tile 光栅化与合成次数
 * @description 统计不同平移量下单帧重建的 tile 数与被 blit 的次数，说明 tile 缓存的真实边界。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";

const VW = 900, VH = 700;
let counting = null;

globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    const c = createCanvas(w, h);
    // 只统计输出画布（尺寸等于视口）的 drawImage，tile 画布尺寸不同
    const ctx = c.getContext("2d");
    // 输出画布尺寸等于视口；tile 位图尺寸随块边长与倍率变，不能按大小区间判断
    const isOutput = w === VW && h === VH;
    if (isOutput) {
      const original = ctx.drawImage.bind(ctx);
      ctx.drawImage = (...args) => {
        if (counting) counting.blits++;
        return original(...args);
      };
    }
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

const boardCore = new BoardCore({ width: 1024, height: 1024 });
const viewport = new ViewportCore({ boardCore, viewportId: "blit", width: VW, height: VH, postRenderFrame() {}, tiles: true });
viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: 1, viewportSize: { width: VW, height: VH }, force: true });
await new Promise((r) => setTimeout(r, 80));
const renderer = viewport.renderer;
const aom = boardCore.activeObjectManager;
aom.renderHooks = {
  requestActiveRender(o = []) { renderer.invalidateActiveObjects(o); viewport.markFrameDirty(); },
  requestStaticRender(c = []) { renderer.invalidateChunks(c); viewport.markFrameDirty(); },
  requestStaticRenderForObjects(o = [], c = [], p) { renderer.invalidateCachedObjects(o, { previousWorldRects: p }); viewport.markFrameDirty(); },
  requestViewportRender() { viewport.markFrameDirty(); },
};
for (let i = 0; i < 600; i++) {
  const points = [];
  for (let k = 0; k < 30; k++) points.push({ x: k * 3, y: Math.sin(k) * 18 });
  const s = new StrokeObject(i + 1, new Vector((i % 22) * 40, Math.floor(i / 22) * 40), { color: "#222", width: 3 }, { points });
  boardCore.registerObjectInstance(s); aom.add([s]); aom.apply([s]);
}
viewport.flushRenderFrame();
await new Promise((r) => setTimeout(r, 100));
viewport.flushRenderFrame();

/**
 * 平移指定距离并采样一帧
 * @param {number} dx - 横向位移
 * @returns {{ dx: number, blits: number, rebuilds: number, tiles: number, ms: number }}
 */
function pan(dx) {
  const before = renderer.getTileDebugInfo();
  counting = { blits: 0 };
  const t0 = performance.now();
  viewport.onViewportChange({ origin: { x: viewport.origin.x + dx, y: viewport.origin.y }, zoom: 1 });
  viewport.flushRenderFrame();
  const ms = performance.now() - t0;
  const after = renderer.getTileDebugInfo();
  const result = {
    dx,
    blits: counting.blits,
    rebuilds: after.rebuildCount - before.rebuildCount,
    tiles: after.tileCount,
    ms,
  };
  counting = null;
  return result;
}

console.log(`tile 边长 ${renderer.getTileDebugInfo().tileSize}，视口 ${VW}x${VH}`);
console.log("平移量 | blit 次数 | 重建 tile 数 | 已分配 tile 数 | 一帧耗时");
for (const dx of [30, 30, 30, 200, 300, 500, 900, 30, 30]) {
  const r = pan(dx);
  console.log(
    `${String(r.dx).padStart(6)} | ${String(r.blits).padStart(9)} | ${String(r.rebuilds).padStart(12)} | ${String(r.tiles).padStart(14)} | ${r.ms.toFixed(2).padStart(8)}ms`,
  );
  await new Promise((res) => setTimeout(res, 30));
}
process.exit(0);
