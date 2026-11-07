/**
 * @jest-environment node
 */

/**
 * @file tile 模式下选中与提交的渲染回归测试
 * @description 用真实 BoardCore/AOM 验证对象在静态层与活动层之间迁移时不消失。
 * @module host/tile-commit-render-test
 * @author Zhou Chenyu
 */

import { BoardCore } from "../kernel/board/board-core.js";
import { ViewportCore } from "../renderers/canvas/viewport-core.js";
import { StrokeObject } from "../kernel/objects/stroke/stroke.js";
import { Vector } from "../kernel/utils/math.js";
import { RectangleRange } from "../kernel/range/rectangle.js";

/**
 * 记录型 2D 上下文
 * @description 方法放在原型上，视口上下文的方法表枚举依赖这一形态。
 */
class RecordingContext {
  /**
   * @param {Array<any>} log - 调用记录
   */
  constructor(log) {
    this.log = log;
  }

  /** @returns {void} */
  save() {}
  /** @returns {void} */
  restore() {}
  /** @returns {void} */
  beginPath() {}
  /** @returns {void} */
  closePath() {}
  /** @returns {void} */
  clip() {}
  /** @returns {void} */
  fill() {}
  /** @returns {void} */
  fillRect() {}
  /** @returns {void} */
  arc() {}
  /** @returns {void} */
  ellipse() {}
  /** @returns {void} */
  rect() {}
  /** @returns {void} */
  setLineDash() {}

  /** @param {...number} args - 变换参数 @returns {void} */
  setTransform(...args) {
    this.log.push(["setTransform", ...args]);
  }

  /** @param {...number} args - 坐标 @returns {void} */
  moveTo(...args) {
    this.log.push(["moveTo", ...args]);
  }

  /** @param {...number} args - 坐标 @returns {void} */
  lineTo(...args) {
    this.log.push(["lineTo", ...args]);
  }

  /** @returns {void} */
  stroke() {
    this.log.push(["stroke"]);
  }

  /** @param {...number} args - 清理参数 @returns {void} */
  clearRect(...args) {
    this.log.push(["clearRect", ...args]);
  }

  /** @param {...any} args - 拷贝参数 @returns {void} */
  drawImage(...args) {
    this.log.push(["drawImage", ...args]);
  }
}

/**
 * 记录型画布
 */
class RecordingCanvas {
  /**
   * @param {number} width - 宽
   * @param {number} height - 高
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.log = [];
    this.ctx = new RecordingContext(this.log);
  }

  /**
   * 取 2D 上下文
   * @returns {RecordingContext}
   */
  getContext() {
    return this.ctx;
  }

  /**
   * 转出位图
   * @returns {Object} 位图替身
   */
  transferToImageBitmap() {
    return { width: this.width, height: this.height, close() {} };
  }

  /**
   * 统计某类调用次数
   * @param {string} name - 调用名
   * @returns {number}
   */
  count(name) {
    return this.log.filter((call) => call[0] === name).length;
  }
}

/**
 * 安装记录型 OffscreenCanvas 与手动 rAF
 * @returns {{ canvases: RecordingCanvas[], restore: () => void }}
 */
function installRecordingHost() {
  const previousCanvas = globalThis.OffscreenCanvas;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const canvases = [];

  globalThis.OffscreenCanvas = class extends RecordingCanvas {
    constructor(width, height) {
      super(width, height);
      canvases.push(this);
    }
  };
  // rAF 不自动回调，帧由测试显式驱动
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
 * 建立真实内核与视口，并接通 AOM 渲染钩子
 * @returns {Promise<Object>}
 */
async function createBoardScenario() {
  const host = installRecordingHost();
  const boardCore = new BoardCore({ width: 800, height: 600 });
  boardCore.width = 800;
  boardCore.height = 600;

  const viewport = new ViewportCore({
    boardCore,
    viewportId: "tile-commit-test",
    width: 800,
    height: 600,
    postRenderFrame() {},
  });
  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
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

  const strokes = [];
  for (let i = 0; i < 3; i++) {
    const stroke = new StrokeObject(
      i + 1,
      new Vector(50 + i * 100, 50),
      { color: "#1a1a1a", width: 2 },
      {
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 10 },
          { x: 80, y: 0 },
        ],
      },
    );
    boardCore.registerObjectInstance(stroke);
    strokes.push(stroke);
  }
  aom.add(strokes);
  aom.apply(strokes);
  viewport.flushRenderFrame();

  return { host, boardCore, viewport, renderer, aom, strokes };
}

describe("tile 模式下选中与提交", () => {
  test("静态对象进入 AOM 后由输出层现画", async () => {
    const { host, viewport, aom, strokes } = await createBoardScenario();
    try {
      const output = host.canvases[0];
      output.log.length = 0;

      aom.add([strokes[0]]);
      viewport.flushRenderFrame();

      expect(aom.has(strokes[0].id)).toBe(true);
      expect(output.count("stroke")).toBeGreaterThan(0);
    } finally {
      host.restore();
    }
  });

  test("选中对象移动并提交后仍然可见", async () => {
    const { host, viewport, aom, strokes } = await createBoardScenario();
    try {
      const output = host.canvases[0];
      const moved = strokes[0];

      aom.add([moved]);
      viewport.flushRenderFrame();
      output.log.length = 0;

      moved.position.x += 200;
      moved.position.y += 100;
      aom.apply([moved]);
      viewport.flushRenderFrame();

      // 提交后对象离开 AOM，必须在新位置上真的画出来，否则就是消失
      const expectedX = 50 + 200;
      const expectedY = 50 + 100;
      const drawnSomewhere = host.canvases.some((canvas) =>
        canvas.log.some(
          (call) =>
            call[0] === "setTransform" &&
            Math.abs(call[5] - expectedX) < 1 &&
            Math.abs(call[6] - expectedY) < 1,
        ),
      );
      expect(drawnSomewhere).toBe(true);
    } finally {
      host.restore();
    }
  });

  test("取消选中后对象回到 tile 而不是消失", async () => {
    const { host, viewport, renderer, aom, strokes } = await createBoardScenario();
    try {
      const moved = strokes[0];
      aom.add([moved]);
      viewport.flushRenderFrame();

      const before = renderer.getTileDebugInfo().rebuildCount;
      aom.discard([moved]);
      viewport.flushRenderFrame();

      expect(aom.has(moved.id)).toBe(false);
      expect(renderer.getTileDebugInfo().rebuildCount).toBeGreaterThan(before);
    } finally {
      host.restore();
    }
  });
});
