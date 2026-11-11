/**
 * @jest-environment node
 */

/**
 * @file 缩放预览的像素回归测试
 * @description 断言预览帧确实把上一帧内容画出来了，防止裁剪路径写错导致整屏白屏。
 * @module host/zoom-preview-pixels-test
 * @author Zhou Chenyu
 */

import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../kernel/board/board-core.js";
import { ViewportCore } from "../renderers/canvas/viewport-core.js";
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
 * 统计输出画布上的不透明像素占比
 * @param {Object} renderer - 渲染器
 * @returns {number} 占比 0 到 1
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

describe("缩放预览的像素输出", () => {
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
   * 建一个铺满视口的视口
   * @returns {Promise<Object>} 视口上下文
   */
  async function createFilledViewport() {
    const boardCore = new BoardCore({ width: 320, height: 240 });
    const viewport = new ViewportCore({
      boardCore,
      viewportId: "zoom-preview-pixels",
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      postRenderFrame() {},
      tiles: true,
    });
    viewport.onViewportChange({
      origin: { x: 0, y: 0 },
      zoom: 1,
      viewportSize: { ...VIEWPORT },
      force: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

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

    // 一个覆盖整个视口的实心圆，任何未绘制的区域都会露成透明
    const circle = new CircleObject(1, new Vector(-200, -200), {
      strokeColor: "#1a1a1a",
      fillColor: "#1a1a1a",
      strokeWidth: 8,
    });
    circle.data.radius = 2000;
    circle.calculateRectangle?.();
    boardCore.registerObjectInstance(circle);
    aom.add([circle]);
    aom.apply([circle]);

    viewport.flushRenderFrame();
    await new Promise((resolve) => setTimeout(resolve, 60));
    viewport.flushRenderFrame();
    return { viewport, renderer, boardCore, aom };
  }

  test("放大预览帧把上一帧内容画出来而不是整屏白屏", async () => {
    const { viewport, renderer } = await createFilledViewport();
    try {
      expect(opaqueRatio(renderer)).toBeGreaterThan(0.95);

      viewport.onViewportChange({
        origin: { x: 0, y: 0 },
        zoom: 1.2,
        viewportSize: { ...VIEWPORT },
      });
      viewport.flushRenderFrame();

      // 预览帧是拉伸的上一帧，必须仍然铺满
      expect(opaqueRatio(renderer)).toBeGreaterThan(0.95);
    } finally {
      viewport.destroy();
    }
  });

  test("缩小预览的外圈包含活动层对象，不被静态层盖住", async () => {
    const { viewport, renderer, boardCore, aom } = await createFilledViewport();
    try {
      // 活动层对象放在缩小时会落到外圈的位置
      const active = new CircleObject(99, new Vector(370, 280), {
        strokeColor: "#00ff00",
        fillColor: "#00ff00",
        strokeWidth: 2,
      });
      active.data.radius = 25;
      active.calculateRectangle?.();
      boardCore.registerObjectInstance(active);
      aom.add([active]);
      viewport.flushRenderFrame();

      viewport.onViewportChange({
        origin: { x: 0, y: 0 },
        zoom: 0.8,
        viewportSize: { ...VIEWPORT },
      });
      viewport.flushRenderFrame();

      // 缩小时快照只占中心，该点在右下外圈，必须由外圈补画画上活动层对象
      const canvas = renderer.canvas;
      const pixel = Array.from(
        canvas.getContext("2d").getImageData(296, 224, 1, 1).data,
      );
      expect(pixel).toEqual([0, 255, 0, 255]);
    } finally {
      viewport.destroy();
    }
  });

  test("缩小后整帧重建，同样不留白", async () => {
    const { viewport, renderer } = await createFilledViewport();
    try {
      viewport.onViewportChange({
        origin: { x: 0, y: 0 },
        zoom: 0.8,
        viewportSize: { ...VIEWPORT },
      });
      viewport.flushRenderFrame();

      // 缩小后快照只占中心，外圈必须现画，整屏同样不能留白
      expect(opaqueRatio(renderer)).toBeGreaterThan(0.95);
    } finally {
      viewport.destroy();
    }
  });
});
