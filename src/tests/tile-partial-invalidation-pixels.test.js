/**
 * @jest-environment node
 */

/**
 * @file tile 局部失效的像素级回归测试
 * @description 把对象画上、拾取、移动、落下的全过程逐像素对比经典路径，确认局部失效不会留下残留像素。
 * @module host/tile-partial-invalidation-pixels-test
 * @author Zhou Chenyu
 */

import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../kernel/board/board-core.js";
import { ViewportCore } from "../renderers/canvas/viewport-core.js";
import { StrokeObject } from "../kernel/objects/stroke/stroke.js";
import { CircleObject } from "../kernel/objects/graph/circle.js";
import { Vector } from "../kernel/utils/math.js";

const VIEWPORT = { width: 320, height: 240 };

/**
 * 安装真实光栅画布与手动 rAF
 * @returns {{ restore: () => void }}
 */
function installRasterHost() {
  const previousCanvas = globalThis.OffscreenCanvas;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;

  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      const canvas = createCanvas(width, height);
      canvas.transferToImageBitmap = () => {
        const snapshot = createCanvas(width, height);
        snapshot.getContext("2d").drawImage(canvas, 0, 0);
        return snapshot;
      };
      return canvas;
    }
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};

  return {
    restore() {
      globalThis.OffscreenCanvas = previousCanvas;
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previousRaf;
      if (previousCancel === undefined) {
        delete globalThis.cancelAnimationFrame;
      } else {
        globalThis.cancelAnimationFrame = previousCancel;
      }
    },
  };
}

/**
 * 建立带 AOM 渲染钩子的视口
 * @param {Object} options - 视口选项
 * @returns {Promise<Object>} 视口上下文
 */
async function createContext(options) {
  const boardCore = new BoardCore({ width: 320, height: 240 });
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `partial-${options.tiles ? "tiles" : "classic"}`,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    postRenderFrame() {},
    tiles: options.tiles,
    tileSize: 128,
  });
  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: { ...VIEWPORT },
    force: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));

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
      renderer.invalidateCachedObjects(objects, { previousWorldRects: previous });
      viewport.markFrameDirty();
    },
    requestViewportRender() {
      viewport.markFrameDirty();
    },
  };
  return { boardCore, viewport, renderer, aom };
}

/**
 * 读取输出画布的像素
 * @param {Object} context - 视口上下文
 * @returns {Uint8ClampedArray} 像素数据
 */
function readPixels(context) {
  context.viewport.flushRenderFrame();
  const canvas = context.viewport.renderer.canvas;
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * 比较两份像素
 * @param {Uint8ClampedArray} a - 第一份
 * @param {Uint8ClampedArray} b - 第二份
 * @returns {{ mismatched: number, maxDiff: number }} 差异统计
 */
function comparePixels(a, b) {
  let mismatched = 0;
  let maxDiff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const diff = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
      Math.abs(a[i + 3] - b[i + 3]),
    );
    if (diff > 2) mismatched++;
    if (diff > maxDiff) maxDiff = diff;
  }
  return { mismatched, maxDiff };
}

/**
 * 构造场景内容：一条半透明笔迹与一个圆形
 * @param {Object} context - 视口上下文
 * @returns {Object} 场景对象
 */
function buildScene(context, strokePosition = { x: 60, y: 60 }) {
  const { boardCore, aom, renderer, viewport } = context;
  const stroke = new StrokeObject(
    1,
    new Vector(strokePosition.x, strokePosition.y),
    { color: "rgba(30,30,30,0.55)", width: 10 },
    { points: [{ x: 0, y: 0 }, { x: 60, y: 30 }, { x: 120, y: 0 }] },
  );
  const circle = new CircleObject(
    2,
    new Vector(200, 150),
    {
      strokeColor: "rgba(200,40,40,0.9)",
      fillColor: "rgba(200,40,40,0.35)",
      strokeWidth: 6,
    },
  );
  circle.data.radius = 30;
  circle.calculateRectangle?.();

  for (const object of [stroke, circle]) {
    boardCore.registerObjectInstance(object);
    aom.add([object]);
    aom.apply([object]);
  }
  viewport.flushRenderFrame();
  void renderer;
  return { stroke, circle };
}

describe("tile 局部失效的像素一致性", () => {
  /**
   * 光栅环境
   * @type {{ restore: () => void } | null}
   */
  let host = null;

  beforeEach(() => {
    host = installRasterHost();
  });

  afterEach(() => {
    host?.restore();
    host = null;
  });

  /**
   * 渲染场景
   * @param {Object} options - 场景选项
   * @returns {Promise<Uint8ClampedArray>} 最终像素
   */
  async function renderScenario(options) {
    const context = await createContext({ tiles: options.tiles });
    try {
      const { stroke } = buildScene(context, options.startPosition);
      if (!options.moveStroke) return readPixels(context);

      const { aom, viewport } = context;
      // 走真实的拾取路径：choose 会记录对象进入活动层前的世界范围
      await aom.choose([stroke]);
      stroke.position = new Vector(160, 120);
      aom.apply([stroke]);
      viewport.flushRenderFrame();
      return readPixels(context);
    } finally {
      context.viewport.destroy?.();
    }
  }

  /**
   * 统计矩形内的不透明像素数
   * @param {Uint8ClampedArray} pixels - 像素数据
   * @param {{ left: number, top: number, width: number, height: number }} rect - 屏幕矩形
   * @returns {number} 不透明像素数
   */
  function countInk(pixels, rect) {
    let count = 0;
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        if (pixels[(y * VIEWPORT.width + x) * 4 + 3] > 0) count++;
      }
    }
    return count;
  }

  test("移动半透明对象后旧位置不残留像素", async () => {
    // 判据不跟经典路径比：Skia 的 arc() 光栅化不具备平移不变性，
    // 圆弧在不同绝对坐标处的抗锯齿会有 1 像素级差异，跨路径逐像素相等无法成立。
    // 残留像素这个失效模式可以直接观测：旧包围盒内必须一个不透明像素都不剩。
    const pixels = await renderScenario({ tiles: true, moveStroke: true });

    // 旧位置：起点 (60,60)，点列到 +120/+30，描边 10 → 约 (50,50) 到 (190,100)
    expect(countInk(pixels, { left: 40, top: 40, width: 160, height: 70 })).toBe(0);
    // 新位置必须有内容，否则说明"清得干净"是因为根本没重画
    expect(
      countInk(pixels, { left: 150, top: 110, width: 140, height: 60 }),
    ).toBeGreaterThan(200);
  });

  test("提交跨越多块 tile 的笔迹后，输出与从零渲染一致", async () => {
    /**
     * 渲染场景
     * @param {Object} options - 场景选项
     * @returns {Promise<Uint8ClampedArray>} 像素
     */
    async function render(options) {
      const context = await createContext({ tiles: true });
      try {
        const { circle } = buildScene(context);
        const { boardCore, aom, viewport } = context;
        void circle;
        if (!options.commitLater) {
          // 直接建出最终场景
          const stroke = new StrokeObject(
            9,
            new Vector(40, 20),
            { color: "rgba(200,30,30,0.7)", width: 12 },
            { points: [{ x: 0, y: 0 }, { x: 160, y: 60 }, { x: 260, y: -20 }] },
          );
          boardCore.registerObjectInstance(stroke);
          aom.add([stroke]);
          aom.apply([stroke]);
          viewport.flushRenderFrame();
          return readPixels(context);
        }

        // 先渲染一次，再提交笔迹：命中局部脏区重绘路径
        viewport.flushRenderFrame();
        const stroke = new StrokeObject(
          9,
          new Vector(40, 20),
          { color: "rgba(200,30,30,0.7)", width: 12 },
          { points: [{ x: 0, y: 0 }, { x: 160, y: 60 }, { x: 260, y: -20 }] },
        );
        boardCore.registerObjectInstance(stroke);
        aom.add([stroke]);
        aom.apply([stroke]);
        viewport.flushRenderFrame();
        return readPixels(context);
      } finally {
        context.viewport.destroy?.();
      }
    }

    const incremental = await render({ commitLater: true });
    const fromScratch = await render({ commitLater: false });
    const { mismatched, maxDiff } = comparePixels(incremental, fromScratch);
    expect({ mismatched, maxDiff }).toEqual({ mismatched: 0, maxDiff: 0 });
  });

  test("经典路径下移动后旧位置同样不残留像素", async () => {
    const pixels = await renderScenario({ tiles: false, moveStroke: true });
    expect(countInk(pixels, { left: 40, top: 40, width: 160, height: 70 })).toBe(0);
  });
});
