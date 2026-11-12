/**
 * @file 半透明填充下的逐帧双组合检测
 * @description 每帧增量输出必须与强制全量重建的结果一致；填充半透明，重复绘制会变暗。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../../src/kernel/board/board-core.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";
import { CircleObject } from "../../src/kernel/objects/graph/circle.js";
import { Vector } from "../../src/kernel/utils/math.js";

const W = 360;
const H = 300;

const originalOffscreen = globalThis.OffscreenCanvas;
const originalRaf = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;

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

async function waitLoaded(viewport) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const chunks = viewport.chunkLoader.getLoadedChunks();
    if (chunks.length > 0 && chunks.every((chunk) => chunk.isLoad)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * 汇总像素统计
 * @param {Uint8ClampedArray} data - 像素
 * @returns {{ alpha: number, rgb: number }}
 */
function summarize(data) {
  let alpha = 0;
  let rgb = 0;
  for (let i = 0; i < data.length; i += 4) {
    alpha += data[i + 3];
    rgb += data[i] + data[i + 1] + data[i + 2];
  }
  return { alpha, rgb };
}

/**
 * 比较两份像素
 * @param {Uint8ClampedArray} a - 基准
 * @param {Uint8ClampedArray} b - 对比
 * @returns {{ count: number, maxDiff: number }}
 */
function compare(a, b) {
  let count = 0;
  let maxDiff = 0;
  for (let i = 0; i < a.length; i += 4) {
    let diff = 0;
    for (let channel = 0; channel < 4; channel++) {
      diff = Math.max(diff, Math.abs(a[i + channel] - b[i + channel]));
    }
    if (diff <= 2) continue;
    count++;
    maxDiff = Math.max(maxDiff, diff);
  }
  return { count, maxDiff };
}

/**
 * 场景：逐帧画半透明圆并提交
 * @param {boolean} tiles - 是否启用 tile
 * @returns {Promise<Array<{step: number, count: number, maxDiff: number, alphaDelta: number, rgbDelta: number}>>}
 */
async function run(tiles) {
  const boardCore = new BoardCore({ width: W, height: H });
  boardCore.width = W;
  boardCore.height = H;
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `fill-${tiles}`,
    width: W,
    height: H,
    postRenderFrame() {},
    tiles,
  });
  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: { width: W, height: H },
    force: true,
  });
  await waitLoaded(viewport);

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

  const ctx = renderer._canvas.getContext("2d");
  const failures = [];
  let nextId = 1;

  /**
   * 创建一个半透明圆
   * @param {number} index - 序号
   * @returns {CircleObject}
   */
  const createCircle = (index) => {
    const hue = (index * 47) % 360;
    const circle = new CircleObject(nextId++, new Vector(60 + (index % 4) * 70, 60 + Math.floor(index / 4) * 70), {
      strokeColor: `hsl(${hue}, 70%, 42%)`,
      fillColor: `hsla(${hue}, 75%, 60%, 0.22)`,
      width: 4,
    });
    circle.data.radius = 24;
    circle.calculateRectangle?.();
    return circle;
  };

  for (let step = 0; step < 24; step++) {
    const circle = createCircle(step);
    boardCore.registerObjectInstance(circle);
    aom.add([circle]);
    viewport.markFrameDirty();

    // 逐帧长大，模拟拖拽
    for (let grow = 0; grow < 3; grow++) {
      circle.data.radius = 24 + grow * 8;
      circle.calculateRectangle?.();
      aom.apply([circle]);
      viewport.flushRenderFrame();
    }

    // 提交后立即比对增量输出与全量重建
    circle.data.radius = 48;
    circle.calculateRectangle?.();
    aom.apply([circle]);
    viewport.flushRenderFrame();

    const incremental = ctx.getImageData(0, 0, W, H).data;
    const incrementalSummary = summarize(incremental);

    renderer.invalidateCachedObjects([]);
    renderer.invalidateViewport();
    viewport.flushRenderFrame();
    const reference = ctx.getImageData(0, 0, W, H).data;
    const referenceSummary = summarize(reference);

    const result = compare(reference, incremental);
    if (result.count > 0) {
      failures.push({
        step,
        count: result.count,
        maxDiff: result.maxDiff,
        alphaDelta: incrementalSummary.alpha - referenceSummary.alpha,
        rgbDelta: incrementalSummary.rgb - referenceSummary.rgb,
      });
    }

    // 恢复增量状态
    viewport.markFrameDirty();
    viewport.flushRenderFrame();
  }

  return failures;
}

try {
  for (const tiles of [false, true]) {
    const failures = await run(tiles);
    console.log(
      `\ntiles=${String(tiles).padEnd(5)} 失败帧数=${failures.length}/24`,
    );
    for (const failure of failures.slice(0, 6)) {
      console.log(
        `  step=${failure.step} 差异像素=${failure.count} 最大Δ=${failure.maxDiff}` +
          ` alphaΔ=${failure.alphaDelta} rgbΔ=${failure.rgbDelta}`,
      );
    }
  }
} finally {
  globalThis.OffscreenCanvas = originalOffscreen;
  if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRaf;
  if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = originalCancel;
}
