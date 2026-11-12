/**
 * @jest-environment node
 */

/**
 * @file 画布尺寸变更与缓存完整性回归测试
 * @description 验证尺寸归一化不产生空转重置，且缓存被重置后必定走全量重建。
 * @module canvas/resize-consistency-test
 * @author Zhou Chenyu
 */

import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../../../kernel/board/board-core.js";
import { ViewportCore } from "../viewport-core.js";
import { CircleObject } from "../../../kernel/objects/graph/circle.js";
import { Vector } from "../../../kernel/utils/math.js";

const WIDTH = 800;
const HEIGHT = 600;

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
 * 建立真实内核、视口与 AOM 钩子
 * @returns {Promise<Object>}
 */
async function createScenario() {
  const host = installRasterHost();
  const boardCore = new BoardCore({ width: WIDTH, height: HEIGHT });
  boardCore.width = WIDTH;
  boardCore.height = HEIGHT;

  const viewport = new ViewportCore({
    boardCore,
    viewportId: "resize-consistency-test",
    width: WIDTH,
    height: HEIGHT,
    postRenderFrame() {},
    tiles: false,
  });
  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: { width: WIDTH, height: HEIGHT },
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
 * 提交一个圆并使其进入静态图
 * @param {Object} scenario - 场景
 * @param {number} id - 对象 id
 * @param {{x: number, y: number}} center - 世界圆心
 * @param {number} radius - 半径
 * @returns {CircleObject}
 */
function addCircle(scenario, id, center, radius) {
  const circle = new CircleObject(
    id,
    new Vector(center.x, center.y),
    { color: "#c0392b", width: 4 },
  );
  circle.data.radius = radius;
  circle.calculateRectangle?.();
  scenario.boardCore.registerObjectInstance(circle);
  scenario.aom.add([circle]);
  scenario.aom.apply([circle]);
  return circle;
}

/**
 * 统计区域内可见像素数
 * @param {Uint8ClampedArray} pixels - RGBA 像素
 * @param {number} width - 画布宽度
 * @param {number} x0 - 左边界
 * @param {number} y0 - 上边界
 * @param {number} x1 - 右边界
 * @param {number} y1 - 下边界
 * @returns {number} alpha 达到可见阈值的像素数
 */
function countInk(pixels, width, x0, y0, x1, y1) {
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 64) count++;
    }
  }
  return count;
}

/**
 * 读取整幅输出像素
 * @param {ReturnType<typeof createCanvas>} canvas - 输出画布
 * @returns {Uint8ClampedArray} RGBA 像素
 */
function readPixels(canvas) {
  return canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height).data;
}

describe("画布尺寸变更与缓存完整性", () => {
  test("小数尺寸不应被当作尺寸变化而重置画布", async () => {
    const scenario = await createScenario();
    const { host, renderer } = scenario;
    try {
      // 尺寸赋值会重置画布内容，因此实质未变的尺寸必须返回 false
      expect(renderer.resize(800.4, 600.4)).toBe(false);
      expect(renderer.outputCanvas.width).toBe(800);
      expect(renderer.outputCanvas.height).toBe(600);
    } finally {
      host.restore();
    }
  });

  test("缓存被尺寸重置后，局部脏区刷新也必须全量重建缓存", async () => {
    const scenario = await createScenario();
    const { host, viewport, renderer } = scenario;
    try {
      addCircle(scenario, 1, { x: 150, y: 150 }, 90);
      addCircle(scenario, 2, { x: 600, y: 450 }, 80);
      viewport.flushRenderFrame();

      const cacheBefore = readPixels(renderer.getStaticCache());
      const firstRegion = countInk(cacheBefore, WIDTH, 40, 40, 260, 260);
      const secondRegion = countInk(cacheBefore, WIDTH, 500, 350, 700, 550);
      expect(firstRegion).toBeGreaterThan(500);
      expect(secondRegion).toBeGreaterThan(500);

      // 真实尺寸变更：缓存画布被重置（内容全空）
      renderer.resize(900, 700);

      // 仅提交一个与任何对象都不相交的小脏区
      // 缓存不完整时必须忽略此局部性并全量重建，否则两个圆的像素永久丢失
      renderer.invalidate({
        left: 820,
        top: 640,
        right: 870,
        bottom: 690,
        width: 50,
        height: 50,
      });
      viewport.markFrameDirty();
      viewport.flushRenderFrame();

      const cacheAfter = readPixels(renderer.getStaticCache());
      expect(countInk(cacheAfter, 900, 40, 40, 260, 260)).toBe(firstRegion);
      expect(countInk(cacheAfter, 900, 500, 350, 700, 550)).toBe(secondRegion);
    } finally {
      host.restore();
    }
  });
});
