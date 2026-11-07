/**
 * @jest-environment node
 */

/**
 * @file tile 提交路径的像素级回归测试
 * @description 用真实光栅器对比提交前后像素，检测非预期擦除（白边）与对象消失。
 * @module host/tile-commit-pixels-test
 * @author Zhou Chenyu
 */

import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../kernel/board/board-core.js";
import { ViewportCore } from "../renderers/canvas/viewport-core.js";
import { StrokeObject } from "../kernel/objects/stroke/stroke.js";
import { Vector } from "../kernel/utils/math.js";

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
async function createRasterScenario(options = {}) {
  const host = installRasterHost();
  const origin = options.origin ?? { x: 0, y: 0 };
  const boardCore = new BoardCore({ width: 800, height: 600 });
  boardCore.width = 800;
  boardCore.height = 600;

  const viewport = new ViewportCore({
    boardCore,
    viewportId: "tile-pixels-test",
    width: 800,
    height: 600,
    postRenderFrame() {},
    tiles: options.tiles,
  });
  viewport.onViewportChange({
    origin,
    zoom: 1,
    viewportSize: { width: 800, height: 600 },
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
    requestStaticRenderForObjects(objects = [], chunks = [], previousWorldRects) {
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
 * 注册一条笔画并提交进静态图
 * @param {Object} scenario - 场景
 * @param {number} id - 对象 id
 * @param {Vector} position - 世界位置
 * @param {Array<{x: number, y: number}>} points - 局部点列
 * @returns {StrokeObject}
 */
function addStroke(scenario, id, position, points) {
  const stroke = new StrokeObject(
    id,
    position,
    { color: "#1a1a1a", width: 4 },
    { points },
  );
  scenario.boardCore.registerObjectInstance(stroke);
  scenario.aom.add([stroke]);
  scenario.aom.apply([stroke]);
  return stroke;
}

/**
 * 读取整幅 alpha 通道
 * @param {ReturnType<typeof createCanvas>} canvas - 输出画布
 * @returns {Uint8ClampedArray} RGBA 像素
 */
function readPixels(canvas) {
  return canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * 统计由有变无的像素数量
 * @param {Uint8ClampedArray} before - 前帧像素
 * @param {Uint8ClampedArray} after - 后帧像素
 * @param {(x: number, y: number) => boolean} [ignore] - 允许丢失的区域
 * @returns {{ lost: number, samples: Array<{x: number, y: number}> }}
 */
function countLostPixels(before, after, width, ignore = () => false) {
  let lost = 0;
  const samples = [];
  for (let i = 0; i < before.length; i += 4) {
    const index = i / 4;
    const x = index % width;
    const y = Math.floor(index / width);
    if (ignore(x, y)) continue;
    // alpha < 16 属于抗锯齿边缘，裁剪重绘时光栅器会有 ±1 的覆盖抖动，
    // 不计入擦除；这里要抓的是可见内容的丢失（白边、对象消失）
    if (before[i + 3] >= 16 && after[i + 3] === 0) {
      lost++;
      if (samples.length < 12) samples.push({ x, y });
    }
  }
  return { lost, samples };
}

describe("tile 提交路径的像素正确性", () => {
  test("提交新对象不应抹掉任何已有像素", async () => {
    const scenario = await createRasterScenario();
    const { host, viewport } = scenario;
    try {
      // 一条贯穿的长斜线作为已有内容
      addStroke(scenario, 1, new Vector(0, 0), [
        { x: 0, y: 0 },
        { x: 700, y: 500 },
      ]);
      viewport.flushRenderFrame();
      const before = readPixels(scenario.output);

      // 提交一个无关小对象，它的包围盒就是脏区
      addStroke(scenario, 2, new Vector(300, 200), [
        { x: 0, y: 0 },
        { x: 40, y: 30 },
      ]);
      viewport.flushRenderFrame();
      const after = readPixels(scenario.output);

      const { lost, samples } = countLostPixels(before, after, 800);
      expect({ lost, samples }).toEqual({ lost: 0, samples: [] });
    } finally {
      host.restore();
    }
  });

  test("关闭 tile 时提交新对象也不应抹掉已有像素（对照组）", async () => {
    const scenario = await createRasterScenario({ tiles: false });
    const { host, viewport } = scenario;
    try {
      addStroke(scenario, 1, new Vector(0, 0), [
        { x: 0, y: 0 },
        { x: 700, y: 500 },
      ]);
      viewport.flushRenderFrame();
      const before = readPixels(scenario.output);

      addStroke(scenario, 2, new Vector(300, 200), [
        { x: 0, y: 0 },
        { x: 40, y: 30 },
      ]);
      viewport.flushRenderFrame();
      const after = readPixels(scenario.output);

      const { lost, samples } = countLostPixels(before, after, 800);
      expect({ lost, samples }).toEqual({ lost: 0, samples: [] });
    } finally {
      host.restore();
    }
  });

  test("移动提交只在旧位置丢像素，新位置必须有内容", async () => {
    const scenario = await createRasterScenario();
    const { host, viewport, aom } = scenario;
    try {
      const moved = addStroke(scenario, 1, new Vector(100, 100), [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
      ]);
      // 另一条不相关的内容，不应被移动牵连
      addStroke(scenario, 2, new Vector(100, 300), [
        { x: 0, y: 0 },
        { x: 500, y: 200 },
      ]);
      viewport.flushRenderFrame();
      const before = readPixels(scenario.output);

      aom.add([moved]);
      moved.position.x += 300;
      moved.position.y += 150;
      aom.apply([moved]);
      viewport.flushRenderFrame();
      const after = readPixels(scenario.output);

      // 新位置附近必须有像素，否则对象就是消失了
      const ctx = scenario.output.getContext("2d");
      const newSpot = ctx.getImageData(430, 250, 1, 1).data;
      expect(newSpot[3]).toBeGreaterThan(0);

      const oldRect = { left: 90, top: 90, right: 175, bottom: 115 };
      const { lost, samples } = countLostPixels(
        before,
        after,
        800,
        (x, y) =>
          x >= oldRect.left &&
          x <= oldRect.right &&
          y >= oldRect.top &&
          y <= oldRect.bottom,
      );
      expect({ lost, samples }).toEqual({ lost: 0, samples: [] });
    } finally {
      host.restore();
    }
  });

  test("多选一起移动并提交，每个对象在新位置都必须有内容", async () => {
    const scenario = await createRasterScenario();
    const { host, viewport, aom } = scenario;
    try {
      const strokes = [
        addStroke(scenario, 1, new Vector(100, 100), [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
        ]),
        addStroke(scenario, 2, new Vector(100, 160), [
          { x: 0, y: 0 },
          { x: 60, y: 20 },
        ]),
        addStroke(scenario, 3, new Vector(100, 220), [
          { x: 0, y: 0 },
          { x: 60, y: 40 },
        ]),
      ];
      viewport.flushRenderFrame();
      const before = readPixels(scenario.output);

      aom.add(strokes);
      for (const stroke of strokes) {
        stroke.position.x += 300;
        stroke.position.y += 150;
      }
      aom.apply(strokes);
      viewport.flushRenderFrame();
      const after = readPixels(scenario.output);

      const ctx = scenario.output.getContext("2d");
      // 三个对象的新位置都要有像素
      for (const [index, point] of [
        [0, [430, 250]],
        [1, [430, 320]],
        [2, [430, 390]],
      ]) {
        const spot = ctx.getImageData(point[0], point[1], 1, 1).data;
        expect({ index, alpha: spot[3] }).toEqual({
          index,
          alpha: expect.any(Number),
        });
        expect(spot[3]).toBeGreaterThan(0);
      }

      // 三个旧位置之外不允许有任何像素丢失
      const { lost, samples } = countLostPixels(
        before,
        after,
        800,
        (x, y) => x >= 90 && x <= 175 && y >= 90 && y <= 275,
      );
      expect({ lost, samples }).toEqual({ lost: 0, samples: [] });
    } finally {
      host.restore();
    }
  });

  test("视口平移后提交新对象与移动对象都保持正确", async () => {
    const scenario = await createRasterScenario({
      origin: { x: 300, y: 200 },
    });
    const { host, viewport, aom } = scenario;
    try {
      // 世界坐标 (300,200) 是屏幕左上角
      addStroke(scenario, 1, new Vector(300, 200), [
        { x: 0, y: 0 },
        { x: 700, y: 500 },
      ]);
      const moved = addStroke(scenario, 2, new Vector(400, 300), [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
      ]);
      viewport.flushRenderFrame();
      const before = readPixels(scenario.output);

      aom.add([moved]);
      moved.position.x += 300;
      moved.position.y += 150;
      aom.apply([moved]);
      viewport.flushRenderFrame();
      const after = readPixels(scenario.output);

      // 新位置世界 (700,450)，屏幕 (400,250)
      const spot = scenario.output
        .getContext("2d")
        .getImageData(400, 250, 1, 1).data;
      expect(spot[3]).toBeGreaterThan(0);

      const { lost, samples } = countLostPixels(
        before,
        after,
        800,
        (x, y) => x >= 90 && x <= 175 && y >= 90 && y <= 115,
      );
      expect({ lost, samples }).toEqual({ lost: 0, samples: [] });
    } finally {
      host.restore();
    }
  });

  test("反复移动提交不应侵蚀已缓存像素", async () => {
    const scenario = await createRasterScenario();
    const { host, viewport, aom } = scenario;
    try {
      // 两个对象紧贴放置：清除时的整数扩边带会落在另一个对象身上，
      // 扩边带内的内容必须在重绘时一并恢复，否则会被反复啃掉
      const strokes = [
        addStroke(scenario, 1, new Vector(120.4, 120.6), [
          { x: 0, y: 0 },
          { x: 80, y: 40 },
        ]),
        addStroke(scenario, 2, new Vector(120.4, 121.9), [
          { x: 0, y: 0 },
          { x: 80, y: 40 },
        ]),
      ];
      viewport.flushRenderFrame();
      const baseline = readPixels(scenario.output);

      // 模拟用户连续拖拽提交：每次小幅移动后提交，最后回到原位
      const offsets = [
        [17.3, 9.6],
        [31.7, -12.4],
        [-8.2, 23.9],
        [-40.8, -21.1],
        [0, 0],
      ];
      for (const [dx, dy] of offsets) {
        aom.add(strokes);
        for (const stroke of strokes) {
          stroke.position.x += dx;
          stroke.position.y += dy;
        }
        aom.apply(strokes);
        viewport.flushRenderFrame();
      }

      const restored = readPixels(scenario.output);
      // 回到原位后应与初始画面逐像素一致，否则就是局部重绘在侵蚀缓存
      const { lost, samples } = countLostPixels(baseline, restored, 800);
      expect({ lost, samples }).toEqual({ lost: 0, samples: [] });
    } finally {
      host.restore();
    }
  });

  test("经典路径下多选移动提交，每个对象在新位置也必须存在", async () => {
    const scenario = await createRasterScenario({ tiles: false });
    const { host, viewport, aom } = scenario;
    try {
      const strokes = [
        addStroke(scenario, 1, new Vector(100, 100), [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
        ]),
        addStroke(scenario, 2, new Vector(100, 160), [
          { x: 0, y: 0 },
          { x: 60, y: 20 },
        ]),
        addStroke(scenario, 3, new Vector(100, 220), [
          { x: 0, y: 0 },
          { x: 60, y: 40 },
        ]),
      ];
      viewport.flushRenderFrame();

      aom.add(strokes);
      for (const stroke of strokes) {
        stroke.position.x += 300;
        stroke.position.y += 150;
      }
      aom.apply(strokes);
      viewport.flushRenderFrame();

      const ctx = scenario.output.getContext("2d");
      for (const point of [
        [430, 250],
        [430, 320],
        [430, 390],
      ]) {
        expect(ctx.getImageData(point[0], point[1], 1, 1).data[3]).toBeGreaterThan(
          0,
        );
      }
    } finally {
      host.restore();
    }
  });

  test("保持选中状态下移动提交，对象由输出层现画且不丢其他像素", async () => {
    const scenario = await createRasterScenario();
    const { host, viewport, aom } = scenario;
    try {
      const moved = addStroke(scenario, 1, new Vector(100, 100), [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
      ]);
      addStroke(scenario, 2, new Vector(100, 300), [
        { x: 0, y: 0 },
        { x: 500, y: 200 },
      ]);
      viewport.flushRenderFrame();
      const before = readPixels(scenario.output);

      aom.add([moved]);
      moved.position.x += 300;
      moved.position.y += 150;
      aom.apply([moved]);
      // 选择器会保持选中：对象仍在 AOM，输出层现画
      aom.add([moved]);
      viewport.flushRenderFrame();
      const after = readPixels(scenario.output);

      const newSpot = scenario.output
        .getContext("2d")
        .getImageData(430, 250, 1, 1).data;
      expect(newSpot[3]).toBeGreaterThan(0);

      const { lost, samples } = countLostPixels(
        before,
        after,
        800,
        (x, y) => x >= 90 && x <= 175 && y >= 90 && y <= 115,
      );
      expect({ lost, samples }).toEqual({ lost: 0, samples: [] });
    } finally {
      host.restore();
    }
  });
});
