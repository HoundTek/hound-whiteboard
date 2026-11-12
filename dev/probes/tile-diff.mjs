/**
 * @file tile 合成与经典缓存路径的逐像素差分
 * @description 同一场景、同一视口状态下，比较 tiles 开与关的输出图像。
 * @author Zhou Chenyu
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
 * 渲染指定配置并返回输出画布的像素
 * @param {boolean} tiles - 是否启用 tile
 * @param {number} originX - 视口原点
 * @param {number} originY - 视口原点
 * @returns {Promise<{ data: Uint8ClampedArray, origin: { x: number, y: number } }>} 输出像素与实际生效的视口原点
 */
async function render(tiles, originX, originY) {
  const boardCore = new BoardCore({ width: W, height: H });
  boardCore.width = W;
  boardCore.height = H;
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `tiles-${tiles}-${originX}-${originY}`,
    width: W,
    height: H,
    postRenderFrame() {},
    tiles,
  });
  viewport.onViewportChange({
    origin: { x: originX, y: originY },
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

  viewport.flushRenderFrame();
  viewport.flushRenderFrame();

  const ctx = renderer._canvas.getContext("2d");
  return {
    data: ctx.getImageData(0, 0, W, H).data,
    origin: { x: viewport.origin.x, y: viewport.origin.y },
  };
}

/**
 * 比较两份像素并统计差异的空间分布
 * @param {Uint8ClampedArray} a - 基准像素
 * @param {Uint8ClampedArray} b - 对比像素
 * @returns {{ different: number, maxDiff: number, columns: number[], inkBase: number, inkTest: number, lost: number, gained: number }}
 */
function compare(a, b) {
  const columns = new Set();
  let different = 0;
  let maxDiff = 0;
  let inkBase = 0;
  let inkTest = 0;
  let lost = 0;
  let gained = 0;
  for (let i = 0; i < a.length; i += 4) {
    const baseAlpha = a[i + 3];
    const testAlpha = b[i + 3];
    inkBase += baseAlpha;
    inkTest += testAlpha;
    const alphaDiff = testAlpha - baseAlpha;
    if (alphaDiff < 0) lost += -alphaDiff;
    else gained += alphaDiff;
    let diff = 0;
    for (let channel = 0; channel < 4; channel++) {
      diff = Math.max(diff, Math.abs(a[i + channel] - b[i + channel]));
    }
    if (diff <= 2) continue;
    different++;
    maxDiff = Math.max(maxDiff, diff);
    columns.add((i / 4) % W);
  }
  return {
    different,
    maxDiff,
    columns: [...columns].sort((x, y) => x - y),
    inkBase,
    inkTest,
    lost,
    gained,
  };
}

try {
  for (const [originX, originY] of [
    [0, 0],
    [0.5, 0],
    [0.37, 0.61],
    [200.25, 40.75],
  ]) {
    const tiled = await render(true, originX, originY);
    // tile 模式会把视口原点量化到整数，真值必须用实际生效的 origin
    const classic = await render(false, tiled.origin.x, tiled.origin.y);
    const withTiles = tiled.data;
    const withoutTiles = classic.data;
    const result = compare(withoutTiles, withTiles);
    const nearBoundary = result.columns.filter(
      (x) => Math.abs(x - (512 - originX)) <= 2,
    ).length;
    const span =
      result.columns.length === 0
        ? "无"
        : `${result.columns[0]}..${result.columns[result.columns.length - 1]}（共 ${result.columns.length} 列）`;
    console.log(
      `origin=(${originX}, ${originY})→生效(${tiled.origin.x}, ${tiled.origin.y}) | 差异像素=${String(result.different).padStart(5)} | 最大通道差=${String(result.maxDiff).padStart(3)}` +
        ` | 墨量经典=${result.inkBase} tile=${result.inkTest} (${((result.inkTest / result.inkBase - 1) * 100).toFixed(2)}%)` +
        ` | 丢失=${result.lost} 新增=${result.gained} | 差异列=${span} | 边界±2px=${nearBoundary}`,
    );
  }
} finally {
  globalThis.OffscreenCanvas = originalOffscreen;
  if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRaf;
  if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = originalCancel;
}
