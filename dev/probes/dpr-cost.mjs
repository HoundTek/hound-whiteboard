/**
 * @file 设备像素倍率的渲染代价测量
 * @description 比较同一视口在 DPR=1 与 DPR=2 下的提交与平移耗时，用于评估高分屏的固有成本。
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
const STROKES = Number(process.env.STROKES ?? 600);

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
 * @param {ViewportCore} viewport - 目标视口
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
 * 建立测量场景
 * @param {number} dpr - 设备像素倍率
 * @param {boolean} tiles - 是否启用 tile
 * @returns {Promise<Object>}
 */
async function createScenario(dpr, tiles) {
  const boardCore = new BoardCore({ width: W, height: H });
  boardCore.width = W;
  boardCore.height = H;
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `dpr-cost-${dpr}-${tiles}`,
    width: W,
    height: H,
    postRenderFrame() {},
    tiles,
    devicePixelRatio: dpr,
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

  for (let i = 0; i < STROKES; i++) {
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
  return { viewport, boardCore, aom, renderer };
}

/**
 * 测量提交与平移耗时
 * @param {number} dpr - 设备像素倍率
 * @param {boolean} tiles - 是否启用 tile
 * @returns {Promise<Object>}
 */
async function measure(dpr, tiles) {
  const scenario = await createScenario(dpr, tiles);
  const { viewport, boardCore, aom, renderer } = scenario;

  const commitTimes = [];
  for (let i = 0; i < 15; i++) {
    const circle = new CircleObject(
      200000 + i,
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
    commitTimes.push(performance.now() - start);
  }

  const panTimes = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    viewport.onViewportChange({
      origin: { x: 20 * (i + 1), y: 0 },
      zoom: 1,
    });
    viewport.flushRenderFrame();
    panTimes.push(performance.now() - start);
  }

  const p95 = (list) => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  };

  // 校验：位图尺寸、缓存尺寸与墨迹像素数，防止测到空转路径
  const output = renderer.outputCanvas;
  const cache = renderer.getStaticCache();
  const data = output.getContext("2d").getImageData(0, 0, output.width, output.height).data;
  let ink = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) ink++;

  return {
    commit: p95(commitTimes),
    pan: p95(panTimes),
    tiles: renderer.getTileDebugInfo().tileCount,
    enabled: renderer.getTileDebugInfo().enabled,
    outputSize: `${output.width}x${output.height}`,
    cacheSize: `${cache.width}x${cache.height}`,
    ink,
  };
}

try {
  console.log(`视口 ${W}x${H}，静态笔画 ${STROKES}`);

  // 单轮测量受 JIT 与 GC 影响可达数倍偏差，必须多轮交错取中位数
  const ROUNDS = 3;
  const configs = [
    ["DPR=1 经典", 1, false],
    ["DPR=1 tile", 1, true],
    ["DPR=2 经典", 2, false],
    ["DPR=2 tile", 2, true],
  ];
  const samples = new Map(configs.map(([label]) => [label, []]));
  let last = new Map();

  for (let round = 0; round < ROUNDS; round++) {
    for (const [label, dpr, tiles] of configs) {
      const result = await measure(dpr, tiles);
      samples.get(label).push(result);
      last.set(label, result);
    }
  }

  const median = (list) => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  console.log(
    "配置 | 提交 p95(中位) | 平移 p95(中位) | 输出位图 | 缓存位图 | 墨迹像素 | tile",
  );
  const summary = new Map();
  for (const [label] of configs) {
    const rounds = samples.get(label);
    const commit = median(rounds.map((item) => item.commit));
    const pan = median(rounds.map((item) => item.pan));
    summary.set(label, { commit, pan });
    const info = last.get(label);
    console.log(
      `${label.padEnd(12)} | ${commit.toFixed(2).padStart(12)}ms | ${pan.toFixed(2).padStart(12)}ms | ${info.outputSize.padStart(9)} | ${info.cacheSize.padStart(9)} | ${String(info.ink).padStart(8)} | ${info.enabled ? info.tiles : "关"}`,
    );
  }

  const base = summary.get("DPR=1 经典");
  const tiled = summary.get("DPR=1 tile");
  const hidpi = summary.get("DPR=2 tile");
  console.log(
    `DPR=1 tile 相对经典：提交 ×${(tiled.commit / base.commit).toFixed(2)}，平移 ×${(tiled.pan / base.pan).toFixed(2)}`,
  );
  const hidpiClassic = summary.get("DPR=2 经典");
  console.log(
    `DPR=2 tile 相对 DPR=2 经典：提交 ×${(hidpi.commit / hidpiClassic.commit).toFixed(2)}，平移 ×${(hidpi.pan / hidpiClassic.pan).toFixed(2)}`,
  );
} finally {
  globalThis.OffscreenCanvas = originalOffscreen;
  if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRaf;
  if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = originalCancel;
}
