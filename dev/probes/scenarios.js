/**
 * @file 跨引擎测量场景定义
 * @description 同一份场景既能在 Node 的 @napi-rs/canvas 上跑，也能在浏览器原生画布上跑，用于对比两个引擎的成本。
 * @author Zhou Chenyu
 */

import { BoardCore } from "../../src/kernel/board/board-core.js";
import { StrokeObject } from "../../src/kernel/objects/stroke/stroke.js";
import { Vector } from "../../src/kernel/utils/math.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";

/**
 * 视口尺寸（CSS 像素）
 * @type {{ width: number, height: number }}
 */
export const VIEWPORT = Object.freeze({ width: 1200, height: 900 });

/**
 * 区块边长（世界单位）
 * @type {number}
 */
const CHUNK_SIZE = 1024;

/**
 * 一次场景的总笔画数
 * @type {number}
 */
const STROKE_COUNT = 300;

/**
 * 单条笔画的点数
 * @type {number}
 */
const POINTS_PER_STROKE = 120;

/**
 * 确定性伪随机数发生器
 * @param {number} seed - 随机种子
 * @returns {() => number} [0,1) 区间发生器
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * 生成一条笔画的点列
 * @param {number} count - 点数
 * @param {() => number} random - 随机发生器
 * @returns {Array<{ x: number, y: number }>} 局部坐标点列
 */
function createStrokePoints(count, random) {
  const points = [];
  let x = 0;
  let y = 0;
  let heading = random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    heading += (random() - 0.5) * 0.6;
    x += Math.cos(heading) * 3;
    y += Math.sin(heading) * 3;
    points.push({ x, y });
  }
  return points;
}

/**
 * 把 AOM 的渲染钩子接到视口上
 * @param {Object} viewport - 视口
 * @param {Object} boardCore - 板
 * @returns {void}
 */
function installRenderHooks(viewport, boardCore) {
  const renderer = viewport.renderer;

  boardCore.activeObjectManager.renderHooks = {
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
}

/**
 * 建一个铺满笔画的视口
 * @description 静态内容走真实的 AOM 提交路径写进区块，与产品里的提交一致。
 * @param {{ tiles?: boolean, strokes?: number, points?: number }} [options={}] - 夹具选项
 * @returns {Promise<Object>} 夹具
 */
export async function createFixture(options = {}) {
  const strokeCount = options.strokes ?? STROKE_COUNT;
  const pointCount = options.points ?? POINTS_PER_STROKE;
  const random = createRandom(20261112);

  const boardCore = new BoardCore({ width: CHUNK_SIZE, height: CHUNK_SIZE });
  const viewport = new ViewportCore({
    boardCore,
    viewportId: `parity-${options.tiles === false ? "classic" : "tile"}`,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    postRenderFrame() {},
    // 真机是 Retina，Node 侧固定同一倍率，否则两边像素数差 4 倍，读数不可比
    devicePixelRatio: 2,
    ...(options.tiles === undefined ? {} : { tiles: options.tiles }),
  });

  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: VIEWPORT,
    force: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  installRenderHooks(viewport, boardCore);

  const aom = boardCore.activeObjectManager;
  const strokes = [];
  for (let i = 0; i < strokeCount; i++) {
    const stroke = new StrokeObject(
      i + 1,
      new Vector(random() * VIEWPORT.width, random() * VIEWPORT.height),
      { color: "#1a1a1a", width: 2 },
      { points: createStrokePoints(pointCount, random) },
    );
    boardCore.registerObjectInstance(stroke);
    strokes.push(stroke);
  }
  aom.add(strokes);
  aom.apply(strokes);

  viewport.flushRenderFrame();
  await new Promise((resolve) => setTimeout(resolve, 120));
  viewport.flushRenderFrame();

  return { viewport, renderer: viewport.renderer, boardCore, aom, strokes };
}

/**
 * 等待输出画布真正完成光栅化
 * @description
 * 浏览器把绘制指令交给 GPU 后立即返回，`flushRenderFrame()` 的耗时只是指令提交。
 * 读一个像素会建立栅栏，等到光栅化完成；不这么做，浏览器读数会比 Node 的同步
 * CPU 光栅化低一个数量级，两种口径无法对比。
 * @param {Object} renderer - 渲染器
 * @returns {void}
 */
function syncRaster(renderer) {
  const canvas = renderer?.canvas;
  if (!canvas) return;
  canvas.getContext("2d").getImageData(0, 0, 1, 1);
}

/**
 * 采样一个操作的耗时分布
 * @param {() => (void | Promise<void>)} fn - 被测操作
 * @param {{ samples?: number, warmup?: number }} [options={}] - 采样配置
 * @returns {Promise<{ p50: number, p95: number }>} 中位数与 95 分位（毫秒）
 */
export async function measureStats(fn, options = {}) {
  const samples = options.samples ?? 21;
  const warmup = options.warmup ?? 3;
  for (let i = 0; i < warmup; i++) await fn();

  const timings = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await fn();
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return {
    p50: timings[Math.floor(timings.length / 2)],
    p95: timings[Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1)],
  };
}

/**
 * 单组配置的测量
 * @param {{ label: string, viewport: Object, strokes: number, tiles: boolean }} config - 配置
 * @param {(row: Object) => void} record - 结果回收
 * @returns {Promise<void>}
 */
async function measureConfig(config, record) {
  const viewport = config.viewport;
  const fixture = await createFixture({
    strokes: config.strokes,
    points: config.points,
    tiles: config.tiles,
  });
  const { aom, boardCore } = fixture;
  const group = `${config.label}${config.tiles ? "" : "｜经典"}`;

  let nextId = fixture.strokes.length + 1;
  record({
    group,
    name: "提交跨块笔迹",
    ...(await measureStats(() => {
      const stroke = new StrokeObject(
        nextId++,
        new Vector(120, 120),
        { color: "#ff0000", width: 3 },
        { points: [{ x: 0, y: 0 }, { x: 600, y: 300 }, { x: 900, y: 60 }] },
      );
      boardCore.registerObjectInstance(stroke);
      aom.add([stroke]);
      aom.apply([stroke]);
      fixture.viewport.flushRenderFrame();
      syncRaster(fixture.renderer);
    })),
  });

  let offset = 0;
  record({
    group,
    name: "平移一帧",
    ...(await measureStats(() => {
      offset += 7;
      fixture.viewport.onViewportChange({
        origin: { x: offset, y: offset },
        zoom: 1,
        viewportSize: viewport,
      });
      fixture.viewport.flushRenderFrame();
      syncRaster(fixture.renderer);
    })),
  });

  for (const zoom of [2, 0.5, 0.05]) {
    record({
      group,
      name: `换档到 ${Math.round(zoom * 100)}%`,
      ...(await measureStats(() => {
        fixture.viewport.onViewportChange({
          origin: { x: 0, y: 0 },
          zoom,
          viewportSize: viewport,
        });
        fixture.viewport.flushRenderFrame();
        syncRaster(fixture.renderer);
        fixture.viewport.onViewportChange({
          origin: { x: 0, y: 0 },
          zoom: 1,
          viewportSize: viewport,
        });
        fixture.viewport.flushRenderFrame();
        syncRaster(fixture.renderer);
      })),
    });
  }

  fixture.viewport.destroy?.();
}

/**
 * 本次扫描的配置表
 * @description 三个维度各自变化，其余保持 1200×900、300 笔画、DPR 2。
 * @type {Array<{ label: string, viewport: Object, strokes: number, tiles: boolean }>}
 */
export const SWEEPS = Object.freeze({
  // 对象数扫描：固定单笔 120 点，改变笔数
  count: [
    { label: "重载 1200×900｜600 笔", viewport: VIEWPORT, strokes: 600, points: 120, tiles: true },
    { label: "基准 1200×900｜300 笔", viewport: VIEWPORT, strokes: 300, points: 120, tiles: true },
    { label: "基准 1200×900｜300 笔", viewport: VIEWPORT, strokes: 300, points: 120, tiles: false },
    { label: "小视口 900×700｜300 笔", viewport: { width: 900, height: 700 }, strokes: 300, points: 120, tiles: true },
    { label: "大视口 1920×1080｜300 笔", viewport: { width: 1920, height: 1080 }, strokes: 300, points: 120, tiles: true },
    { label: "轻载 1200×900｜150 笔", viewport: VIEWPORT, strokes: 150, points: 120, tiles: true },
  ],
  // 点数扫描：固定 300 笔，只改单笔点数
  points: [
    { label: "300 笔 × 30 点", viewport: VIEWPORT, strokes: 300, points: 30, tiles: true },
    { label: "300 笔 × 120 点", viewport: VIEWPORT, strokes: 300, points: 120, tiles: true },
    { label: "300 笔 × 480 点", viewport: VIEWPORT, strokes: 300, points: 480, tiles: true },
  ],
});

/**
 * 默认扫描
 * @type {string}
 */
export const DEFAULT_SWEEP = "count";

/**
 * 运行全部场景
 * @param {{ onProgress?: (row: Object) => void, sweep?: string }} [options={}] - 运行选项
 * @returns {Promise<Array<Object>>} 结果行
 */
export async function runScenarios(options = {}) {
  const report = options.onProgress ?? (() => {});
  const rows = [];
  const sweep = SWEEPS[options.sweep ?? DEFAULT_SWEEP] ?? SWEEPS[DEFAULT_SWEEP];
  for (const config of sweep) {
    await measureConfig(config, (row) => {
      rows.push(row);
      report(row);
    });
  }
  return rows;
}
