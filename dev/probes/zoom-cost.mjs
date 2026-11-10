/**
 * @file 缩放手势的每帧渲染成本
 * @description 缩放档位非 1 时 tile 不参与，走全量重建，量清这条路径的代价。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";
import { BoardCore } from "../../src/kernel/board/board-core.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";
import { StrokeObject } from "../../src/kernel/objects/stroke/stroke.js";
import { Vector } from "../../src/kernel/utils/math.js";

const W = 900;
const H = 700;

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
 * 建立带静态笔画与渲染挂钩的场景
 * @param {number} strokeCount - 笔画数
 * @returns {Promise<{ viewport: ViewportCore, renderer: Object }>}
 */
async function setup(strokeCount) {
  const boardCore = new BoardCore({ width: W, height: H });
  boardCore.width = W;
  boardCore.height = H;
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `zoom-${strokeCount}-${Math.random()}`,
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
  return { viewport, renderer };
}

/**
 * 测量缩放帧的 p95 耗时
 * @param {number} strokeCount - 笔画数
 * @returns {Promise<{ zoom: number, pan: number }>}
 */
async function measure(strokeCount) {
  const { viewport, renderer } = await setup(strokeCount);
  const zoomInTimes = [];
  const zoomOutTimes = [];
  const panTimes = [];

  // 连续放大：触控板双指放大这类连续手势
  let zoom = 1;
  for (let i = 0; i < 12; i++) {
    zoom *= 1.02;
    const start = performance.now();
    viewport.onViewportChange({
      origin: { x: 0, y: 0 },
      zoom,
      viewportSize: { width: W, height: H },
    });
    viewport.flushRenderFrame();
    zoomInTimes.push(performance.now() - start);
  }

  // 连续缩小
  const zoomOutClears = { count: 0 };
  const probeCtx = renderer.getStaticCache().getContext("2d");
  const probeClearRect = probeCtx.clearRect.bind(probeCtx);
  probeCtx.clearRect = (...args) => {
    zoomOutClears.count++;
    return probeClearRect(...args);
  };
  for (let i = 0; i < 12; i++) {
    zoom /= 1.02;
    const start = performance.now();
    viewport.onViewportChange({
      origin: { x: 0, y: 0 },
      zoom,
      viewportSize: { width: W, height: H },
    });
    viewport.flushRenderFrame();
    zoomOutTimes.push(performance.now() - start);
  }

  probeCtx.clearRect = probeClearRect;

  // 离散步进：对应 + / - 键一次缩放一倍
  const stepTimes = { in: [], out: [] };
  const cacheClears = { in: 0, out: 0 };
  const cacheCtx = renderer.getStaticCache().getContext("2d");
  const originalClearRect = cacheCtx.clearRect.bind(cacheCtx);
  let counting = null;
  cacheCtx.clearRect = (...args) => {
    if (counting === "in") cacheClears.in++;
    if (counting === "out") cacheClears.out++;
    return originalClearRect(...args);
  };

  for (const direction of ["in", "out"]) {
    counting = direction;
    let stepZoom = direction === "in" ? 1 : 1;
    for (let i = 0; i < 6; i++) {
      stepZoom *= direction === "in" ? 2 : 0.5;
      const start = performance.now();
      viewport.onViewportChange({
        origin: { x: 0, y: 0 },
        zoom: stepZoom,
        viewportSize: { width: W, height: H },
      });
      viewport.flushRenderFrame();
      stepTimes[direction].push(performance.now() - start);
    }
    counting = null;
    // 回到 1 倍并重建，避免下一次测量继承上一次的状态
    viewport.onViewportChange({
      origin: { x: 0, y: 0 },
      zoom: 1,
      viewportSize: { width: W, height: H },
      force: true,
    });
    viewport.flushRenderFrame();
  }
  cacheCtx.clearRect = originalClearRect;

  // 同一缩放档位下的平移作为对照
  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: { width: W, height: H },
    force: true,
  });
  viewport.flushRenderFrame();
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    viewport.onViewportChange({
      origin: { x: i % 4, y: 0 },
      zoom: 1,
      viewportSize: { width: W, height: H },
    });
    viewport.flushRenderFrame();
    panTimes.push(performance.now() - start);
  }

  const p95 = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  };
  return {
    zoomIn: p95(zoomInTimes),
    zoomOut: p95(zoomOutTimes),
    stepIn: p95(stepTimes.in),
    stepOut: p95(stepTimes.out),
    stepCacheClears: cacheClears,
    zoomOutClears: zoomOutClears.count,
    pan: p95(panTimes),
  };
}

try {
  for (const strokeCount of [100, 300, 600]) {
    const result = await measure(strokeCount);
    console.log(
      `${String(strokeCount).padStart(4)} 笔画 | 缩放帧 放大=${result.zoomIn.toFixed(2)}ms 缩小=${result.zoomOut.toFixed(2)}ms` +
        ` | 2x 步进 放大=${result.stepIn.toFixed(2)}ms 缩小=${result.stepOut.toFixed(2)}ms` +
        ` | 缓存重建 放大=${result.stepCacheClears.in} 次 缩小=${result.stepCacheClears.out} 次` +
        ` | 平移=${result.pan.toFixed(2)}ms | 小步缩小缓存重建=${result.zoomOutClears} 次`,
    );
  }
} finally {
  globalThis.OffscreenCanvas = originalOffscreen;
  if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRaf;
  if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = originalCancel;
}
