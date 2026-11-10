/**
 * @file 平移帧的 tile 相位一致性
 * @description tile 按某个 origin 光栅化后，视口平移会让合成偏移变成小数。
 * @author zhouc_yu
 */
import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../../src/kernel/board/board-core.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";
import { StrokeObject } from "../../src/kernel/objects/stroke/stroke.js";
import { Vector } from "../../src/kernel/utils/math.js";

const W = 1024;
const H = 400;

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
 * 搭建场景
 * @param {boolean} tiles - 是否启用 tile
 * @returns {Promise<{ viewport: ViewportCore, ctx: CanvasRenderingContext2D }>}
 */
async function setup(tiles) {
  const boardCore = new BoardCore({ width: W, height: H });
  boardCore.width = W;
  boardCore.height = H;
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `pan-${tiles}-${Math.random()}`,
    width: W,
    height: H,
    postRenderFrame() {},
    tiles,
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
      renderer.invalidateCachedObjects(objects, { previousWorldRects: previous });
      viewport.markFrameDirty();
    },
    requestViewportRender() {
      viewport.markFrameDirty();
    },
  };

  // 横笔画跨越 x=512 的 tile 边界
  const points = [];
  for (let i = 0; i <= 60; i++) points.push({ x: 400 + i * 4, y: 4 });
  const stroke = new StrokeObject(
    1,
    new Vector(0, 180),
    { color: "#000000", width: 6 },
    { points },
  );
  boardCore.registerObjectInstance(stroke);
  aom.add([stroke]);
  aom.apply([stroke]);

  return { viewport, ctx: renderer._canvas.getContext("2d") };
}

/**
 * 设定视口状态
 * @param {ViewportCore} viewport - 视口
 * @param {number} originX - 视口原点
 * @param {number} originY - 视口原点
 * @returns {void}
 */
function setOrigin(viewport, originX, originY) {
  viewport.onViewportChange({
    origin: { x: originX, y: originY },
    zoom: 1,
    viewportSize: { width: W, height: H },
    force: true,
  });
}

/**
 * 比较两份像素
 * @param {Uint8ClampedArray} a - 基准
 * @param {Uint8ClampedArray} b - 对比
 * @returns {{ different: number, maxDiff: number, inkBase: number, inkTest: number }}
 */
function compare(a, b) {
  let different = 0;
  let maxDiff = 0;
  let inkBase = 0;
  let inkTest = 0;
  for (let i = 0; i < a.length; i += 4) {
    inkBase += a[i + 3];
    inkTest += b[i + 3];
    let diff = 0;
    for (let channel = 0; channel < 4; channel++) {
      diff = Math.max(diff, Math.abs(a[i + channel] - b[i + channel]));
    }
    if (diff <= 2) continue;
    different++;
    maxDiff = Math.max(maxDiff, diff);
  }
  return { different, maxDiff, inkBase, inkTest };
}

try {
  for (const delta of [1, 0.5, 0.37]) {
    // A：tile 在整数 origin 建好后平移 delta，走合成-only 路径
    const pan = await setup(true);
    setOrigin(pan.viewport, 0, 0);
    pan.viewport.flushRenderFrame();
    pan.viewport.flushRenderFrame();
    setOrigin(pan.viewport, delta, 0);
    // tile 模式会把视口原点量化到整数，真值必须用实际生效的 origin
    const effectiveOrigin = pan.viewport.origin;
    pan.viewport.flushRenderFrame();
    const panned = new Uint8ClampedArray(
      pan.ctx.getImageData(0, 0, W, H).data,
    );

    // B：直接在目标 origin 全量渲染（经典路径为真值）
    const truth = await setup(false);
    setOrigin(truth.viewport, effectiveOrigin.x, effectiveOrigin.y);
    truth.viewport.flushRenderFrame();
    truth.viewport.flushRenderFrame();
    const reference = new Uint8ClampedArray(
      truth.ctx.getImageData(0, 0, W, H).data,
    );

    const result = compare(reference, panned);
    console.log(
      `请求平移 ${String(delta).padEnd(4)}px → 生效 origin.x=${effectiveOrigin.x} | 差异像素=${String(result.different).padStart(5)}` +
        ` | 最大通道差=${String(result.maxDiff).padStart(3)}` +
        ` | 墨量 真值=${result.inkBase} 合成=${result.inkTest}` +
        ` (${((result.inkTest / result.inkBase - 1) * 100).toFixed(2)}%)`,
    );
  }
} finally {
  globalThis.OffscreenCanvas = originalOffscreen;
  if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRaf;
  if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = originalCancel;
}
