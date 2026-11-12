/**
 * @file 各缩放档位下的 tile 平移与接缝
 * @description 在每个档位测平移帧的重建块数与耗时，并用一整片不透明填充检查块边界有没有缝隙或空白。
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
const { CircleObject } = await import(`${R}/kernel/objects/graph/circle.js`);
const { Vector } = await import(`${R}/kernel/utils/math.js`);

const W = 900, H = 700;

/**
 * 建立视口并挂上渲染钩子
 * @param {number} dpr - 设备倍率
 * @returns {Promise<Object>} 视口上下文
 */
async function createViewport(dpr) {
  const boardCore = new BoardCore({ width: 1024, height: 1024 });
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `zp-${dpr}`,
    width: W,
    height: H,
    postRenderFrame() {},
    tiles: true,
    devicePixelRatio: dpr,
  });
  const renderer = viewport.renderer;
  const aom = boardCore.activeObjectManager;
  aom.renderHooks = {
    requestActiveRender(o = []) { renderer.invalidateActiveObjects(o); viewport.markFrameDirty(); },
    requestStaticRender(c = []) { renderer.invalidateChunks(c); viewport.markFrameDirty(); },
    requestStaticRenderForObjects(o = [], c = [], p) { renderer.invalidateCachedObjects(o, { previousWorldRects: p }); viewport.markFrameDirty(); },
    requestViewportRender() { viewport.markFrameDirty(); },
  };
  return { boardCore, viewport, renderer, aom };
}

/**
 * 计算输出画布上的不透明像素数
 * @param {Object} renderer - 渲染器
 * @returns {{ opaque: number, total: number }} 统计
 */
function coverage(renderer) {
  const canvas = renderer.canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
  return { opaque, total: data.length / 4 };
}

console.log("缩放 | 层级 | 块数 | 平移重建 | 平移耗时 | 覆盖像素占比");
for (const zoom of [0.05, 0.25, 1, 2, 5, 32]) {
  for (const dpr of [1, 2]) {
    const { boardCore, viewport, renderer, aom } = await createViewport(dpr);

    // 一整片不透明填充，覆盖整个视口；块边界若有缝会露成透明
    const cover = new CircleObject(1, new Vector(0, 0), {
      strokeColor: "#111111",
      fillColor: "#111111",
      strokeWidth: 4,
    });
    const radius = (Math.max(W, H) / zoom) * 4;
    cover.data.radius = radius;
    cover.calculateRectangle?.();
    boardCore.registerObjectInstance(cover);
    aom.add([cover]);
    aom.apply([cover]);

    // 再加一些笔迹，让光栅化有实际内容
    for (let i = 0; i < 120; i++) {
      const points = [];
      for (let k = 0; k < 30; k++) points.push({ x: k * 3, y: Math.sin(k) * 18 });
      const stroke = new StrokeObject(i + 2, new Vector((i % 20) * 40, Math.floor(i / 20) * 40), { color: "#e0e0e0", width: 3 }, { points });
      boardCore.registerObjectInstance(stroke);
      aom.add([stroke]);
      aom.apply([stroke]);
    }

    viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom, viewportSize: { width: W, height: H }, force: true });
    viewport.flushRenderFrame();
    await new Promise((r) => setTimeout(r, 250));
    viewport.flushRenderFrame();

    const info = renderer.getTileDebugInfo();
    const covered = coverage(renderer);

    // 平移 37 设备像素；已吸附原点，这一帧应当只做合成
    const before = info.rebuildCount;
    const t0 = performance.now();
    viewport.onViewportChange({ origin: { x: viewport.origin.x + 37 / (zoom * dpr), y: viewport.origin.y }, zoom });
    viewport.flushRenderFrame();
    const panMs = performance.now() - t0;
    const rebuilds = renderer.getTileDebugInfo().rebuildCount - before;

    console.log(
      `${String(zoom).padStart(4)} | ${String(info.level).padStart(4)} | ${String(info.tileCount).padStart(4)} | ${String(rebuilds).padStart(8)} | ${panMs.toFixed(2).padStart(8)}ms | ${((covered.opaque / covered.total) * 100).toFixed(1).padStart(6)}% (DPR${dpr})`,
    );
    viewport.destroy?.();
  }
}
process.exit(0);
