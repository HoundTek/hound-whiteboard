/**
 * @file 连续缩小时的粗层预建与覆盖
 * @description 从 100% 开始按 90% 连续缩小，打印每步重建块数、预建计数与不透明覆盖占比。
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

const W = 900;
const H = 700;
const STROKES = 600;

/**
 * 统计输出画布不透明像素占比
 * @param {Object} renderer - 渲染器
 * @returns {number} 0 到 1
 */
function opaqueRatio(renderer) {
  const canvas = renderer.canvas;
  const data = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height).data;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
  return opaque / (data.length / 4);
}

/**
 * 建立带铺满对象与笔迹的视口
 * @param {number} dpr - 设备倍率
 * @returns {Promise<Object>} 视口上下文
 */
async function setup(dpr) {
  const boardCore = new BoardCore({ width: 1024, height: 1024 });
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `zo-${dpr}`,
    width: W,
    height: H,
    postRenderFrame() {},
    tiles: true,
    devicePixelRatio: dpr,
  });
  const renderer = viewport.renderer;
  const aom = boardCore.activeObjectManager;
  aom.renderHooks = {
    requestActiveRender(objects = []) {
      renderer.invalidateActiveObjects(objects);
      viewport.markFrameDirty();
    },
    requestStaticRender(chunks = []) {
      renderer.invalidateChunks(chunks);
      viewport.markFrameDirty();
    },
    requestStaticRenderForObjects(objects = [], chunks = [], previous) {
      renderer.invalidateCachedObjects(objects, {
        previousWorldRects: previous,
      });
      viewport.markFrameDirty();
    },
    requestViewportRender() {
      viewport.markFrameDirty();
    },
  };

  // 铺满视口，任何未绘制区域都会露成透明
  const cover = new CircleObject(1, new Vector(0, 0), {
    strokeColor: "#111111",
    fillColor: "#111111",
    strokeWidth: 4,
  });
  cover.data.radius = 4000;
  cover.calculateRectangle?.();
  boardCore.registerObjectInstance(cover);
  aom.add([cover]);
  aom.apply([cover]);

  for (let i = 0; i < STROKES; i++) {
    const points = [];
    for (let k = 0; k < 30; k++) {
      points.push({ x: k * 3, y: Math.sin(k) * 18 });
    }
    const stroke = new StrokeObject(
      i + 2,
      new Vector((i % 22) * 40, Math.floor(i / 22) * 40),
      { color: "#222", width: 3 },
      { points },
    );
    boardCore.registerObjectInstance(stroke);
    aom.add([stroke]);
    aom.apply([stroke]);
  }

  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: { width: W, height: H },
    force: true,
  });
  viewport.flushRenderFrame();
  await new Promise((resolve) => setTimeout(resolve, 200));
  viewport.flushRenderFrame();
  return { viewport, renderer };
}

console.log("步骤 | 缩放 | 层倍率 | 预建 | 重建增量 | 重建总数 | 覆盖率");
for (const dpr of [1, 2]) {
  const { viewport, renderer } = await setup(dpr);
  let zoom = 1;
  for (let step = 1; step <= 8; step++) {
    const before = renderer.getTileDebugInfo();
    zoom *= 0.9;
    viewport.onViewportChange({
      origin: viewport.origin,
      zoom,
    });
    viewport.flushRenderFrame();
    const info = renderer.getTileDebugInfo();
    console.log(
      `${String(step).padStart(4)} | ${zoom.toFixed(3).padStart(5)} | ${JSON.stringify(
        info.layerStates,
      )} | ${String(info.prefetchCount).padStart(4)} | ${String(
        info.rebuildCount - before.rebuildCount,
      ).padStart(8)} | ${String(info.rebuildCount).padStart(8)} | ${(
        opaqueRatio(renderer) * 100
      ).toFixed(1)}% (DPR${dpr})`,
    );
  }
  viewport.destroy();
}
process.exit(0);
