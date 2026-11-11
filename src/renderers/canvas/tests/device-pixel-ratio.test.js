/**
 * @jest-environment node
 */

/**
 * @file 高分屏（设备像素倍率）渲染回归测试
 * @description 验证高位图下绘制坐标仍按 CSS 像素解释，且脏区清除与缓存拷贝覆盖完整。
 * @module canvas/device-pixel-ratio-test
 * @author Zhou Chenyu
 */

import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../../../kernel/board/board-core.js";
import { ViewportCore } from "../viewport-core.js";
import { CircleObject } from "../../../kernel/objects/graph/circle.js";
import { Vector } from "../../../kernel/utils/math.js";

const CSS_WIDTH = 200;
const CSS_HEIGHT = 150;
const DPR = 2;

/**
 * 安装真实光栅画布与手动 rAF
 * @returns {{ canvases: Array<ReturnType<typeof createCanvas>>, restore: () => void }}
 */
function installRasterHost() {
  const previousCanvas = globalThis.OffscreenCanvas;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const canvases = [];

  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      const canvas = createCanvas(width, height);
      canvas.transferToImageBitmap = () => {
        const snapshot = createCanvas(width, height);
        snapshot.getContext("2d").drawImage(canvas, 0, 0);
        return snapshot;
      };
      canvases.push(canvas);
      return canvas;
    }
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};

  return {
    canvases,
    restore() {
      globalThis.OffscreenCanvas = previousCanvas;
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previousRaf;
      if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
      else globalThis.cancelAnimationFrame = previousCancel;
    },
  };
}

/**
 * 等待区块加载完成
 * @param {ViewportCore} viewport - 目标视口
 * @returns {Promise<void>}
 */
async function waitForChunksLoaded(viewport) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const chunks = viewport.chunkLoader.getLoadedChunks();
    if (chunks.length > 0 && chunks.every((chunk) => chunk.isLoad)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * 建立高位图渲染场景
 * @param {number} devicePixelRatio - 设备像素倍率
 * @returns {Promise<Object>}
 */
async function createScenario(devicePixelRatio, tiles = false) {
  const host = installRasterHost();
  const boardCore = new BoardCore({
    width: CSS_WIDTH,
    height: CSS_HEIGHT,
  });
  boardCore.width = CSS_WIDTH;
  boardCore.height = CSS_HEIGHT;

  const viewport = new ViewportCore({
    boardCore,
    viewportId: `dpr-${devicePixelRatio}`,
    width: CSS_WIDTH,
    height: CSS_HEIGHT,
    postRenderFrame() {},
    tiles,
    devicePixelRatio,
  });
  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: { width: CSS_WIDTH, height: CSS_HEIGHT },
    force: true,
  });
  await waitForChunksLoaded(viewport);

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
    requestStaticRenderForObjects(
      objects = [],
      chunks = [],
      previousWorldRects,
    ) {
      renderer.invalidateCachedObjects(objects, { previousWorldRects });
      viewport.markFrameDirty();
    },
    requestViewportRender() {
      viewport.markFrameDirty();
    },
  };

  return { host, boardCore, viewport, renderer, aom, output: host.canvases[0] };
}

/**
 * 读取指定设备像素的 alpha
 * @param {ReturnType<typeof createCanvas>} canvas - 画布
 * @param {number} x - 设备像素 x
 * @param {number} y - 设备像素 y
 * @returns {number} alpha
 */
function alphaAt(canvas, x, y) {
  return canvas.getContext("2d").getImageData(x, y, 1, 1).data[3];
}

describe("高分屏设备像素倍率", () => {
  test("位图按 DPR 放大而绘制坐标仍为 CSS 像素", async () => {
    const scenario = await createScenario(DPR);
    const { host, viewport, boardCore, aom, output } = scenario;
    try {
      expect(output.width).toBe(CSS_WIDTH * DPR);
      expect(output.height).toBe(CSS_HEIGHT * DPR);

      // CSS 圆心 (50,50)、半径 20 的圆，提交后应出现在设备像素 (100,100) 附近
      const circle = new CircleObject(1, new Vector(50, 50), {
        color: "#000000",
        width: 4,
      });
      circle.data.radius = 20;
      circle.calculateRectangle?.();
      boardCore.registerObjectInstance(circle);
      aom.add([circle]);
      aom.apply([circle]);
      viewport.flushRenderFrame();

      // 圆心本身是空心，取正上方半径处、描边中线的设备像素
      expect(alphaAt(output, 100, 60)).toBeGreaterThan(128);
      // CSS 空间里圆外很远的点必须仍是空的
      expect(alphaAt(output, 300, 260)).toBe(0);
      // 若坐标被当成设备像素，圆心会落在 (50,50) 而非 (100,100)
      expect(alphaAt(output, 50, 30)).toBe(0);
    } finally {
      host.restore();
    }
  });

  test("脏区清除与缓存拷贝在高位图下覆盖完整", async () => {
    const scenario = await createScenario(DPR);
    const { host, viewport, boardCore, aom, output } = scenario;
    try {
      const circles = [
        { id: 1, cx: 40, cy: 40, r: 30 },
        { id: 2, cx: 160, cy: 110, r: 28 },
      ];
      for (const spec of circles) {
        const circle = new CircleObject(spec.id, new Vector(spec.cx, spec.cy), {
          color: "#1a1a1a",
          width: 3,
        });
        circle.data.radius = spec.r;
        circle.calculateRectangle?.();
        boardCore.registerObjectInstance(circle);
        aom.add([circle]);
        aom.apply([circle]);
      }
      viewport.flushRenderFrame();

      const countInk = (x0, y0, x1, y1) => {
        const data = output
          .getContext("2d")
          .getImageData(0, 0, output.width, output.height).data;
        let count = 0;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (data[(y * output.width + x) * 4 + 3] > 64) count++;
          }
        }
        return count;
      };

      const leftBefore = countInk(0, 0, 140, 140);
      const rightBefore = countInk(240, 160, 400, 300);
      expect(leftBefore).toBeGreaterThan(200);
      expect(rightBefore).toBeGreaterThan(200);

      // 只失效右侧圆附近的小区域，左侧圆必须原样保留
      scenario.renderer.invalidate({
        left: 140,
        top: 100,
        right: 190,
        bottom: 130,
        width: 50,
        height: 30,
      });
      viewport.markFrameDirty();
      viewport.flushRenderFrame();

      expect(countInk(0, 0, 140, 140)).toBe(leftBefore);
      expect(countInk(240, 160, 400, 300)).toBe(rightBefore);
    } finally {
      host.restore();
    }
  });

  test("高位图下 tile 位图按倍率分配", async () => {
    const scenario = await createScenario(DPR, true);
    const { host, viewport, renderer } = scenario;
    try {
      // 先渲染一帧，tile 才会按视口分配
      viewport.flushRenderFrame();

      expect(renderer.deviceScale).toBe(DPR);
      expect(renderer.getStaticCache().width).toBe(CSS_WIDTH * DPR);
      expect(renderer.getStaticCache().height).toBe(CSS_HEIGHT * DPR);

      const info = renderer.getTileDebugInfo();
      // 真的走了 tile 路径，否则下面的一致性断言没有意义
      expect(info.enabled).toBe(true);
      expect(info.tileCount).toBeGreaterThan(0);
      expect(renderer.getTileBitmapSize?.()).toBe(info.tileSize * DPR);
    } finally {
      host.restore();
    }
  });

  test("高位图下 tile 合成与经典路径像素一致", async () => {
    /**
     * 铺满视口的笔画场景
     * @param {Object} scenario - 渲染场景
     * @returns {void}
     */
    const seed = (scenario) => {
      const { boardCore, aom } = scenario;
      for (let i = 0; i < 6; i++) {
        const circle = new CircleObject(
          1000 + i,
          new Vector(30 + (i % 3) * 60, 40 + Math.floor(i / 3) * 60),
          { strokeColor: "#1a1a1a", width: 4 },
        );
        circle.data.radius = 22;
        circle.calculateRectangle?.();
        boardCore.registerObjectInstance(circle);
        aom.add([circle]);
        aom.apply([circle]);
      }
      scenario.viewport.flushRenderFrame();
    };

    const tiled = await createScenario(DPR, true);
    const classic = await createScenario(DPR, false);
    try {
      seed(tiled);
      seed(classic);
      expect(tiled.renderer.getTileDebugInfo().enabled).toBe(true);
      expect(classic.renderer.getTileDebugInfo().enabled).toBe(false);

      const read = (canvas) =>
        canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)
          .data;
      const tiledData = read(tiled.output);
      const classicData = read(classic.output);

      let ink = 0;
      let mismatched = 0;
      for (let i = 3; i < tiledData.length; i += 4) {
        const alpha = tiledData[i];
        if (alpha > 16) ink++;
        if (Math.abs(alpha - classicData[i]) > 16) mismatched++;
      }

      expect(ink).toBeGreaterThan(1000);
      // 两条路径都按全局层叠顺序绘制全量对象，差异只应来自抗锯齿取整
      expect(mismatched / ink).toBeLessThan(0.01);
    } finally {
      tiled.host.restore();
      classic.host.restore();
    }
  });
});
