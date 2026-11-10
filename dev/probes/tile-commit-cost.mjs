/**
 * @file tile 整片重建与经典全量重建的提交成本对比
 * @description 成员变化下两条路径都走全量，比较 tile 模式是否引入额外开销。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../../src/kernel/board/board-core.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";
import { StrokeObject } from "../../src/kernel/objects/stroke/stroke.js";
import { CircleObject } from "../../src/kernel/objects/graph/circle.js";
import { Vector } from "../../src/kernel/utils/math.js";

const W = Number(process.env.W ?? 900);
const H = Number(process.env.H ?? 700);

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
 * 测量提交耗时
 * @param {number} strokeCount - 静态笔画数
 * @param {boolean} tiles - 是否启用 tile
 * @returns {Promise<{ p95: number, tiles: number }>}
 */
async function measure(strokeCount, tiles) {
  const boardCore = new BoardCore({ width: W, height: H });
  boardCore.width = W;
  boardCore.height = H;
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `cost-${tiles}-${strokeCount}`,
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

  for (let i = 0; i < strokeCount; i++) {
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

  const times = [];
  for (let i = 0; i < 15; i++) {
    const circle = new CircleObject(
      100000 + i,
      new Vector(100 + (i % 10) * 60, 120 + Math.floor(i / 10) * 120),
      { strokeColor: "#c0392b", fillColor: "rgba(192,57,43,0.22)", width: 3 },
    );
    circle.data.radius = 25;
    circle.calculateRectangle?.();
    boardCore.registerObjectInstance(circle);
    aom.add([circle]);
    const start = performance.now();
    aom.apply([circle]);
    viewport.flushRenderFrame();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    p95: times[Math.floor(times.length * 0.95)],
    tiles: renderer.getTileDebugInfo().tileCount,
  };
}

try {
  console.log(`视口 ${W}x${H}`);
  console.log("笔画数 | 经典路径(全量) | tile(整片) | 倍率 | tile 数");
  for (const strokeCount of [300]) {
    const classic = await measure(strokeCount, false);
    const tiled = await measure(strokeCount, true, undefined);
    console.log(
      `${String(strokeCount).padStart(6)} | ${classic.p95.toFixed(2).padStart(12)}ms | ${tiled.p95.toFixed(2).padStart(8)}ms | ×${(tiled.p95 / classic.p95).toFixed(2)} | ${tiled.tiles}`,
    );
  }
} finally {
  globalThis.OffscreenCanvas = originalOffscreen;
  if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRaf;
  if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = originalCancel;
}
