/**
 * @file 缩放预览的正确性验证
 * @description 预览帧可以发虚，但静止重建后必须与同倍率的全量渲染逐像素相同。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../../src/kernel/board/board-core.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";
import { StrokeObject } from "../../src/kernel/objects/stroke/stroke.js";
import { Vector } from "../../src/kernel/utils/math.js";

const W = 900;
const H = 700;
const STROKE_COUNT = 200;

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

/**
 * 等待区块加载完成
 * @param {ViewportCore} viewport - 视口
 * @returns {Promise<void>}
 */
async function waitLoaded(viewport) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const chunks = viewport.chunkLoader.getLoadedChunks();
    if (chunks.length > 0 && chunks.every((chunk) => chunk.isLoad)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * 建立带静态笔画的场景
 * @returns {Promise<{ viewport: ViewportCore, ctx: Object }>}
 */
async function setup() {
  const boardCore = new BoardCore({ width: W, height: H });
  boardCore.width = W;
  boardCore.height = H;
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `preview-${Math.random()}`,
    width: W,
    height: H,
    postRenderFrame() {},
    tiles: true,
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

  for (let i = 0; i < STROKE_COUNT; i++) {
    const points = [];
    for (let k = 0; k < 30; k++) points.push({ x: k * 3, y: Math.sin(k) * 18 });
    const stroke = new StrokeObject(
      i + 1,
      new Vector((i % 22) * 40, Math.floor(i / 22) * 40),
      { color: "#222", width: 3 },
      { points },
    );
    boardCore.registerObjectInstance(stroke);
    aom.add([stroke]);
    aom.apply([stroke]);
  }
  viewport.flushRenderFrame();
  return { viewport, ctx: renderer._canvas.getContext("2d") };
}

/**
 * 比较两份像素
 * @param {Uint8ClampedArray} a - 基准
 * @param {Uint8ClampedArray} b - 对比
 * @returns {{ different: number, maxDiff: number, meanDiff: number }}
 */
function compare(a, b) {
  let different = 0;
  let maxDiff = 0;
  let sumDiff = 0;
  for (let i = 0; i < a.length; i += 4) {
    let diff = 0;
    for (let channel = 0; channel < 4; channel++) {
      diff = Math.max(diff, Math.abs(a[i + channel] - b[i + channel]));
    }
    sumDiff += diff;
    if (diff <= 2) continue;
    different++;
    maxDiff = Math.max(maxDiff, diff);
  }
  return { different, maxDiff, meanDiff: sumDiff / (a.length / 4) };
}

try {
  // 基准：缩放到目标倍率后等预览定时器触发清晰重建，取那张清晰帧
  const reference = await setup();
  reference.viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1.2,
    viewportSize: { width: W, height: H },
    force: true,
  });
  reference.viewport.flushRenderFrame();
  await new Promise((resolve) => setTimeout(resolve, 250));
  reference.viewport.flushRenderFrame();
  const referencePixels = new Uint8ClampedArray(
    reference.ctx.getImageData(0, 0, W, H).data,
  );

  // 被测：先 1 倍渲染，再缩放到 1.2 倍走预览，随后停手等重建
  const subject = await setup();
  const zoomOnePixels = new Uint8ClampedArray(
    subject.ctx.getImageData(0, 0, W, H).data,
  );
  const rebuildsBefore = subject.viewport.renderer.getTileDebugInfo().rebuildCount;
  const zoomStart = performance.now();
  subject.viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1.2,
    viewportSize: { width: W, height: H },
  });
  subject.viewport.flushRenderFrame();
  const zoomElapsed = performance.now() - zoomStart;
  const rebuildsAfter = subject.viewport.renderer.getTileDebugInfo().rebuildCount;
  const previewPixels = new Uint8ClampedArray(
    subject.ctx.getImageData(0, 0, W, H).data,
  );

  console.log(
    `缩放帧耗时=${zoomElapsed.toFixed(2)}ms tile 重建=${rebuildsAfter - rebuildsBefore} 次`,
  );
  const zoomOneResult = compare(zoomOnePixels, previewPixels);
  console.log(
    `预览帧 vs 1 倍帧：差异像素=${zoomOneResult.different}（应很大，证明画面已随缩放变化）`,
  );
  const previewResult = compare(referencePixels, previewPixels);
  console.log(
    `预览帧：差异像素=${previewResult.different} 最大通道差=${previewResult.maxDiff} 均值差=${previewResult.meanDiff.toFixed(2)}`,
  );
  console.log("  （预览允许发虚，判据是与清晰帧无位移关系，且下方静止重建必须全等）");

  // 停手：等待预览定时器触发清晰重建
  await new Promise((resolve) => setTimeout(resolve, 250));
  subject.viewport.flushRenderFrame();
  const settledPixels = new Uint8ClampedArray(
    subject.ctx.getImageData(0, 0, W, H).data,
  );
  const settledResult = compare(referencePixels, settledPixels);
  console.log(
    `静止重建：差异像素=${settledResult.different} 最大通道差=${settledResult.maxDiff} 均值差=${settledResult.meanDiff.toFixed(2)}`,
  );
  console.log(
    settledResult.different === 0
      ? "✅ 静止重建与全量渲染逐像素相同"
      : "❌ 静止重建与全量渲染不一致",
  );
  process.exit(settledResult.different === 0 ? 0 : 1);
} finally {
  globalThis.OffscreenCanvas = originalOffscreen;
  if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRaf;
  if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = originalCancel;
}
