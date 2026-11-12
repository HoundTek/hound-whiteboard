/**
 * @file 交互帧预算基准
 * @description 在真实区块加载路径上分别测量 JS 侧与含光栅化的耗时，并按 60fps 预算逐项判定。
 * @module benchmarks/interaction-frame
 * @author Zhou Chenyu
 */

import { BoardCore } from "../src/kernel/board/board-core.js";
import { ViewportCore } from "../src/renderers/canvas/viewport-core.js";
import { StrokeObject } from "../src/kernel/objects/stroke/stroke.js";
import { Vector } from "../src/kernel/utils/math.js";
import { RectangleRange } from "../src/kernel/range/rectangle.js";
import { OBJECT_DRAW_STRATEGIES } from "../src/renderers/canvas/object-draw-strategies.js";
import { createNoopCanvasContext2D } from "../src/test-support/noop-canvas.js";
import { printHeader, printFooter } from "./helpers.js";

/**
 * 目标帧率
 * @type {number}
 */
const TARGET_FPS = 60;

/**
 * 单帧总预算（毫秒）
 * @type {number}
 */
const FRAME_BUDGET_MS = 1000 / TARGET_FPS;

/**
 * worker 侧可占用的单帧比例
 * @description 一帧里 worker 的计算与渲染要和 UI 合成、消息传递、上屏共享 16.7ms，
 * 因此判定阈值取总量的一半，超过即视为该帧无法守住目标帧率。
 * @type {number}
 */
const WORKER_SHARE = 0.5;

/**
 * worker 侧单帧预算（毫秒）
 * @type {number}
 */
const WORKER_BUDGET_MS = FRAME_BUDGET_MS * WORKER_SHARE;

/**
 * 空闲帧预算（毫秒）
 * @description 无脏区时 worker 不应产出帧，且不应产生可观测耗时。
 * @type {number}
 */
const IDLE_BUDGET_MS = 0.5;

/**
 * 视口尺寸（像素）
 * @type {{ width: number, height: number }}
 */
const VIEWPORT_SIZE = Object.freeze({ width: 1920, height: 1080 });

/**
 * 区块尺寸（世界单位）
 * @description 与 ViewportCore 从 board 尺寸推导出的区块大小一致。
 * @type {{ width: number, height: number }}
 */
const CHUNK_SIZE = Object.freeze({ width: 800, height: 600 });

/**
 * 压力场景表
 * @description 笔画数 × 单笔点数，覆盖从空心到画满的区间；所有笔画都落在已加载区块内。
 * @type {Array<{ label: string, strokes: number, points: number }>}
 */
const SCENARIOS = Object.freeze([
  { label: "200 笔 × 100 点", strokes: 200, points: 100 },
  { label: "500 笔 × 200 点", strokes: 500, points: 200 },
  { label: "1000 笔 × 300 点", strokes: 1000, points: 300 },
  { label: "2000 笔 × 300 点", strokes: 2000, points: 300 },
]);

/**
 * 测量模式
 * @description
 * `js` 用空实现上下文，只覆盖 JavaScript、几何与调度成本，用作光栅化成本的基线；
 * `raster` 用真实 CPU 光栅器，覆盖到 canvas 实际绘制成本。
 * @type {{ js: string, raster: string }}
 */
const CANVAS_MODES = Object.freeze({ js: "js", raster: "raster" });

/**
 * 各模式的采样配置
 * @description 光栅化单次耗时长出两个数量级，采样次数相应减少，避免基准跑到分钟级。
 * @type {Record<string, { batches: number, iterations: number }>}
 */
const MEASURE_CONFIG = Object.freeze({
  [CANVAS_MODES.js]: { batches: 25, iterations: 8 },
  [CANVAS_MODES.raster]: { batches: 9, iterations: 2 },
});

/**
 * 预热轮数
 * @type {number}
 */
const WARMUP_ROUNDS = 3;

/**
 * 取分位数
 * @param {number[]} sortedSamples - 已升序排列的样本
 * @param {number} q - 分位（0~1）
 * @returns {number} 分位值
 */
function quantile(sortedSamples, q) {
  if (sortedSamples.length === 0) return NaN;
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(q * sortedSamples.length) - 1),
  );
  return sortedSamples[index];
}

/**
 * 采样一个操作的耗时分布
 * @description 每批迭代多次再折算单次耗时，降低计时器分辨率噪声；保留 p95 以捕捉帧级抖动。
 * @param {() => void} fn - 被测操作
 * @param {{ batches?: number, iterations?: number, warmup?: number }} [options={}] - 采样配置
 * @returns {{ p50: number, p95: number, mean: number }} 单次耗时统计（毫秒）
 */
function measure(fn, options = {}) {
  const batches = options.batches ?? 25;
  const iterations = options.iterations ?? 8;
  const warmup = options.warmup ?? WARMUP_ROUNDS;

  for (let i = 0; i < warmup; i++) fn();

  const samples = [];
  for (let b = 0; b < batches; b++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);

  return {
    p50: quantile(samples, 0.5),
    p95: quantile(samples, 0.95),
    mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
  };
}

/**
 * 采样返回数值的操作
 * @description 与 `measure` 的区别：样本来自被测操作自己报告的值，而不是墙钟差。
 * 用于测量「绘制策略内部」的耗时：CPU 光栅器在刷新画布表面时会做惰性展平与回收，
 * 那部分开销落在 flush 上却与绘制无关，只有向内插才分得开。
 * @param {() => number} fn - 返回本次耗时（毫秒）的操作
 * @param {{ batches?: number, iterations?: number, warmup?: number }} [options={}] - 采样配置
 * @returns {{ p50: number, p95: number, mean: number }} 统计结果（毫秒）
 */
function measureValue(fn, options = {}) {
  const batches = options.batches ?? 25;
  const iterations = options.iterations ?? 8;
  const warmup = options.warmup ?? WARMUP_ROUNDS;

  for (let i = 0; i < warmup; i++) fn();

  const samples = [];
  for (let b = 0; b < batches; b++) {
    let sum = 0;
    for (let i = 0; i < iterations; i++) sum += fn();
    samples.push(sum / iterations);
  }
  samples.sort((a, b) => a - b);

  return {
    p50: quantile(samples, 0.5),
    p95: quantile(samples, 0.95),
    mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
  };
}

/**
 * 安装绘制策略计时器
 * @description 临时包裹注册表中的绘制策略，累加其内部耗时。
 * 包裹本身有 `performance.now()` 开销（每个对象两次），应只用于隔离测量，
 * 不要在测全链时启用。
 * @returns {{ take: () => number, restore: () => void }} 计时器
 */
function installDrawTiming() {
  const originals = new Map();
  let accumulated = 0;
  let calls = 0;

  for (const [key, strategy] of OBJECT_DRAW_STRATEGIES) {
    originals.set(key, strategy);
    OBJECT_DRAW_STRATEGIES.set(key, (ctx, objectInstance) => {
      calls++;
      const start = performance.now();
      strategy(ctx, objectInstance);
      accumulated += performance.now() - start;
    });
  }

  return {
    take() {
      const value = accumulated;
      accumulated = 0;
      return value;
    },
    takeCalls() {
      const value = calls;
      calls = 0;
      return value;
    },
    restore() {
      for (const [key, strategy] of originals) {
        OBJECT_DRAW_STRATEGIES.set(key, strategy);
      }
    },
  };
}

/**
 * 创建带调用计数的 2D 上下文
 * @description 以真实空实现上下文的完整方法表为基底逐个包上计数器。
 * 不使用 catch-all `Proxy`，因为视口上下文需要能枚举出真实存在的方法，
 * 包裹式代理会让方法表变成空的。
 * @returns {{ ctx: CanvasRenderingContext2D, counts: Record<string, number> }} 计数上下文
 */
function createCountingContext() {
  const counts = Object.create(null);
  const ctx = {};

  for (const [name, value] of Object.entries(createNoopCanvasContext2D())) {
    if (typeof value !== "function") {
      ctx[name] = value;
      continue;
    }
    ctx[name] = () => {
      counts[name] = (counts[name] ?? 0) + 1;
      return name === "measureText" ? { width: 0 } : undefined;
    };
  }

  return { ctx, counts };
}

/**
 * 创建 JS 侧画布工厂
 * @description 所有绘制调用都是空函数，只保留视口上下文所需的完整方法表。
 * @returns {(width: number, height: number) => Object} 画布工厂
 */
function createJsCanvasFactory() {
  const context = createNoopCanvasContext2D();

  return (width, height) => ({
    width,
    height,
    getContext: () => context,
    transferToImageBitmap: () => ({ width, height, close() {} }),
  });
}

/**
 * 创建真实光栅化画布工厂
 * @description
 * `@napi-rs/canvas` 没有 `ImageBitmap`，用一张等尺寸快照模拟位图句柄。
 * 这意味着帧回传路径在这里会多付一次整画布拷贝；浏览器里 `transferToImageBitmap`
 * 近似免费，所以该行的读数偏悲观，不参与判定。
 * @param {{ createCanvas: Function }} rasterModule - 真实 canvas 实现
 * @returns {(width: number, height: number) => Object} 画布工厂
 */
/**
 * 位图合成耗时累加器
 * @description tile 合成与帧回传都是 drawImage，不经绘制策略，必须单独计时，
 * 否则平移的成本会被藏到表外。
 * @type {{ value: number }}
 */
const rasterBlitTiming = { value: 0 };

/**
 * 取出并清零位图合成耗时
 * @returns {number} 毫秒
 */
function takeBlitTime() {
  const value = rasterBlitTiming.value;
  rasterBlitTiming.value = 0;
  return value;
}

/**
 * 给上下文包上 drawImage 计时
 * @param {CanvasRenderingContext2D} ctx - 原始上下文
 * @returns {CanvasRenderingContext2D}
 */
function wrapBlitTiming(ctx) {
  if (!ctx || ctx.__blitTimed) return ctx;
  const originalDrawImage = ctx.drawImage.bind(ctx);
  ctx.drawImage = (...args) => {
    const start = performance.now();
    originalDrawImage(...args);
    rasterBlitTiming.value += performance.now() - start;
  };
  ctx.__blitTimed = true;
  return ctx;
}

function createRasterCanvasFactory(rasterModule) {
  return (width, height) => {
    const canvas = rasterModule.createCanvas(width, height);
    const getContext = canvas.getContext.bind(canvas);
    canvas.getContext = (type, ...rest) =>
      wrapBlitTiming(getContext(type, ...rest));
    canvas.transferToImageBitmap = () => {
      const snapshot = rasterModule.createCanvas(width, height);
      snapshot.getContext("2d").drawImage(canvas, 0, 0);
      return snapshot;
    };
    return canvas;
  };
}

/**
 * 安装画布构造器
 * @description 接管 `OffscreenCanvas`，使 ViewportCore 的缓存层与输出层都由同一工厂产出。
 * @param {(width: number, height: number) => Object} createCanvasLike - 画布工厂
 * @returns {() => void} 恢复函数
 */
function installCanvasFactory(createCanvasLike) {
  const previous = globalThis.OffscreenCanvas;

  globalThis.OffscreenCanvas = function OffscreenCanvas(width, height) {
    return createCanvasLike(width, height);
  };

  return () => {
    if (previous === undefined) {
      delete globalThis.OffscreenCanvas;
      return;
    }
    globalThis.OffscreenCanvas = previous;
  };
}

/**
 * 安装受控帧调度宿主
 * @description 基准需要同步驱动帧：若交给 rAF 或 setTimeout 别名，测量窗口内会插入
 * 与被测操作无关的额外 flush，使样本既偏大又不稳定。这里让调度回调入队后永不执行，
 * 只由基准显式调用 flush。
 * @returns {() => void} 恢复函数
 */
function installFrameHost() {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;

  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};

  return () => {
    if (previousRequest === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = previousRequest;
    }
    if (previousCancel === undefined) {
      delete globalThis.cancelAnimationFrame;
    } else {
      globalThis.cancelAnimationFrame = previousCancel;
    }
  };
}

/**
 * 确定性伪随机数发生器
 * @description 让不同轮次、不同规模、不同模式的场景使用同一套笔迹形状，避免形状差异污染对比。
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
 * 生成一条笔迹的点列
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
 * 等待区块加载完成
 * @description 加载是异步的；未完成时静态图可能为空，会让基准在空板上测出虚假的好成绩。
 * @param {import("../src/renderers/canvas/viewport-core.js").ViewportCore} viewport - 视口核心
 * @param {number} timeoutMs - 超时上限
 * @returns {Promise<number>} 已加载完成的区块数
 */
async function waitForChunksLoaded(viewport, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunks = viewport.chunkLoader.getLoadedChunks();
    if (chunks.length > 0 && chunks.every((chunk) => chunk.isLoad)) {
      return chunks.length;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return viewport.chunkLoader.getLoadedChunks().filter((chunk) => chunk.isLoad)
    .length;
}

/**
 * 构建一个场景夹具
 * @description 走真实区块加载路径：先按 2x 视口范围加载区块，再把笔迹提交进这些区块的静态图。
 * 每笔提交都经 ActiveObjectManager 的 add / apply，与真实提交路径一致。
 * @param {{ strokes: number, points: number }} scenario - 场景规模
 * @param {{ seed?: number, activeStrokes?: number, tiles?: boolean }} [options={}] - 夹具选项
 * @returns {Promise<Object>} 夹具
 */
async function buildFixture(scenario, options = {}) {
  const seed = options.seed ?? 20261106;
  const activeStrokes = options.activeStrokes ?? 1;
  const random = createRandom(seed);

  const boardCore = new BoardCore({
    width: CHUNK_SIZE.width,
    height: CHUNK_SIZE.height,
  });
  boardCore.width = CHUNK_SIZE.width;
  boardCore.height = CHUNK_SIZE.height;

  const frames = [];
  const viewport = new ViewportCore({
    boardCore,
    viewportId: "bench-interaction-frame",
    width: VIEWPORT_SIZE.width,
    height: VIEWPORT_SIZE.height,
    postRenderFrame(message) {
      frames.push(message);
    },
    // 不传时 ViewportCore 默认开 tile，与产品一致
    ...(options.tiles === undefined ? {} : { tiles: options.tiles }),
  });

  // force 必须为 true：初始状态与目标状态相同会被判定为无变化而跳过加载
  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: VIEWPORT_SIZE,
    force: true,
  });
  const loadedChunkCount = await waitForChunksLoaded(viewport);

  // 加载区 = 视口世界矩形向四周各扩 50%，笔迹按该范围铺开，
  // 这样所有笔迹都落在已加载区块内，静态缓存的合并范围就与真实交互一致。
  const loadRect = new RectangleRange(
    -VIEWPORT_SIZE.width / 2,
    -VIEWPORT_SIZE.height / 2,
    VIEWPORT_SIZE.width * 2,
    VIEWPORT_SIZE.height * 2,
  );

  const strokes = [];
  for (let i = 0; i < scenario.strokes; i++) {
    const stroke = new StrokeObject(
      i + 1,
      new Vector(
        loadRect.left + random() * loadRect.width,
        loadRect.top + random() * loadRect.height,
      ),
      { color: "#1a1a1a", width: 2 },
      { points: createStrokePoints(scenario.points, random) },
    );
    boardCore.registerObjectInstance(stroke);
    strokes.push(stroke);
  }

  const aom = boardCore.activeObjectManager;
  aom.add(strokes);
  aom.apply(strokes);

  // 保留若干活动笔画在 AOM 中，模拟「正在画一笔的同时静态缓存在重建」
  const activeOnes = strokes.slice(0, activeStrokes);
  if (activeOnes.length > 0) {
    aom.add(activeOnes);
  }

  const renderer = viewport.renderer;
  renderer.flush([]);

  return {
    boardCore,
    viewport,
    renderer,
    staticDrawableCount: renderer.collectStaticDrawables().length,
    activeDrawableCount: renderer.collectActiveDrawables().length,
    loadedChunkCount,
    frames,
    sampleStroke: strokes[0],
  };
}

/**
 * 测量一个场景的各帧类型耗时
 * @param {{ strokes: number, points: number }} scenario - 场景规模
 * @param {{ createCanvasLike: Function, sampleConfig: { batches: number, iterations: number } }} mode - 测量模式
 * @returns {Promise<Object>} 测量结果
 */
async function profileScenario(scenario, mode) {
  const restoreCanvas = installCanvasFactory(mode.createCanvasLike);
  const restoreFrameHost = installFrameHost();

  try {
    const fixture = await buildFixture(scenario, { tiles: mode.tiles });
    const { viewport, renderer, sampleStroke, frames } = fixture;

    // 场景自检：静态图与区块都为空时，后面的数字全是空转，必须显式失败
    if (fixture.staticDrawableCount === 0 || fixture.loadedChunkCount === 0) {
      throw new Error(
        `场景夹具无效：已加载区块 ${fixture.loadedChunkCount}，静态对象 ${fixture.staticDrawableCount}。` +
          "基准拒绝在空板上产出结论。",
      );
    }

    /**
     * 一笔提交后的重绘
     * @description 提交会让静态缓存置脏，渲染侧要重建整张缓存再合成输出层。
     */
    const commitRedraw = () => {
      renderer.invalidateCachedObjects([sampleStroke]);
      // 走输出调度器而不是 flush([])：后者等价于整幅输出重画，
      // 生产路径是调度器合并脏区后只重画相交区域
      renderer._scheduler.flush();
    };

    /**
     * 输出层单帧
     * @description 静态缓存未失效时，仅按脏区重绘活动对象。
     */
    const outputFrame = () => {
      renderer.flush([new RectangleRange(0, 0, 64, 64)]);
    };

    let panDirection = 1;
    let panOriginX = 0;
    /**
     * 平移一帧的 worker 侧全链
     * @description 视口变化会同时触发静态层与活动层失效，再经调度器 flush 产出帧。
     */
    const panFrame = () => {
      // 只在同一批区块内往返：跨过区块边界会触发加载与卸载，
      // 那测的是「平移进入未缓存区」，不是这里要的「tile 命中」
      panOriginX += panDirection;
      if (panOriginX >= 4) panDirection = -1;
      if (panOriginX <= 0) panDirection = 1;
      viewport.onViewportChange({
        origin: { x: panOriginX, y: 0 },
        zoom: 1,
      });
      viewport.flushRenderFrame();
    };

    // 先把上一次 flush 留下的脏区消化掉，保证进入空闲态的起点一致
    renderer.flush([]);
    viewport.flushRenderFrame();

    const idleFrame = () => {
      viewport.flushRenderFrame();
    };

    const sampleOptions = {
      batches: mode.sampleConfig.batches,
      iterations: mode.sampleConfig.iterations,
    };

    const idleFramesBefore = frames.length;
    const idle = measure(idleFrame, sampleOptions);
    const idleFramesProduced = frames.length - idleFramesBefore;

    const transferFrame = () => {
      viewport.markFrameDirty();
      viewport.flushRenderFrame();
    };

    const commit = measure(commitRedraw, sampleOptions);
    const output = measure(outputFrame, sampleOptions);
    const pan = measure(panFrame, sampleOptions);
    const transfer = measure(transferFrame, sampleOptions);

    // 隔离出绘制策略本身的耗时。CPU 光栅器在刷新表面时会做惰性展平与回收，
    // 那部分开销落在全链 flush 上却不属于绘制，混在一起无法用于架构决策。
    let rebuildDraw = null;
    let panDraw = null;
    let drawBreakdown = null;
    if (mode.measureDraw) {
      const timing = installDrawTiming();
      try {
        // 对象绘制与位图合成分别测量：前者随内容量变化，后者是固定尺寸的块拷贝，
        // 混在一起无法判断该优化哪一边
        const objectCommit = measureValue(() => {
          commitRedraw();
          return timing.take();
        }, sampleOptions);
        const blitCommit = measureValue(() => {
          commitRedraw();
          return takeBlitTime();
        }, sampleOptions);
        const objectPan = measureValue(() => {
          panFrame();
          return timing.take();
        }, sampleOptions);
        const blitPan = measureValue(() => {
          panFrame();
          return takeBlitTime();
        }, sampleOptions);
        rebuildDraw = {
          p95: objectCommit.p95 + blitCommit.p95,
          p50: objectCommit.p50 + blitCommit.p50,
          mean: objectCommit.mean + blitCommit.mean,
        };
        panDraw = {
          p95: objectPan.p95 + blitPan.p95,
          p50: objectPan.p50 + blitPan.p50,
          mean: objectPan.mean + blitPan.mean,
        };
        drawBreakdown = { objectCommit, blitCommit, objectPan, blitPan };
      } finally {
        timing.restore();
      }
    }

    // tile 重建次数是「这一帧到底重画了多少内容」的直接证据：
    // 平移若仍为全量重建，这里会等于可见 tile 数而不是 0
    const countTileRebuilds = (fn) => {
      const before = renderer.getTileDebugInfo?.().rebuildCount ?? 0;
      fn();
      return (renderer.getTileDebugInfo?.().rebuildCount ?? 0) - before;
    };
    const commitTileRebuilds = countTileRebuilds(commitRedraw);
    const panTileRebuilds = countTileRebuilds(panFrame);
    const tileInfo = renderer.getTileDebugInfo?.() ?? null;

    return {
      label: `${scenario.strokes} 笔 × ${scenario.points} 点`,
      commitTileRebuilds,
      panTileRebuilds,
      tileInfo,
      strokeCount: scenario.strokes,
      pointCount: scenario.strokes * scenario.points,
      loadedChunkCount: fixture.loadedChunkCount,
      staticDrawableCount: fixture.staticDrawableCount,
      activeDrawableCount: fixture.activeDrawableCount,
      commit,
      output,
      pan,
      transfer,
      idle,
      rebuildDraw,
      panDraw,
      drawBreakdown,
      idleFramesProduced,
    };
  } finally {
    restoreFrameHost();
    restoreCanvas();
  }
}

/**
 * 统计绘制调用量
 * @description 计时用的上下文不产生光栅化，这里单独统计 canvas 调用次数，
 * 作为「每次重建要光栅化多少东西」的规模指标报告。
 * @param {{ strokes: number, points: number }} scenario - 场景规模
 * @returns {Promise<{ commitOps: number, commitLineTo: number, panOps: number, panLineTo: number }>} 调用量
 */
async function countDrawOperations(scenario) {
  const counter = createCountingContext();
  const restoreCanvas = installCanvasFactory(() => ({
    width: VIEWPORT_SIZE.width,
    height: VIEWPORT_SIZE.height,
    getContext: () => counter.ctx,
    transferToImageBitmap: () => ({
      width: VIEWPORT_SIZE.width,
      height: VIEWPORT_SIZE.height,
      close() {},
    }),
  }));
  const restoreFrameHost = installFrameHost();

  try {
    const fixture = await buildFixture(scenario);
    const { viewport, renderer, sampleStroke } = fixture;

    const snapshot = () => {
      const total = Object.values(counter.counts).reduce(
        (sum, value) => sum + value,
        0,
      );
      return { total, lineTo: counter.counts.lineTo ?? 0 };
    };

    /**
     * 清空计数
     * @returns {void}
     */
    const reset = () => {
      for (const key of Object.keys(counter.counts)) delete counter.counts[key];
    };

    reset();
    renderer.invalidateCachedObjects([sampleStroke]);
    renderer._scheduler.flush();
    const commitOps = snapshot();

    reset();
    viewport.onViewportChange({ origin: { x: 1, y: 0 }, zoom: 1 });
    viewport.flushRenderFrame();
    const panOps = snapshot();

    return {
      commitOps: commitOps.total,
      commitLineTo: commitOps.lineTo,
      panOps: panOps.total,
      panLineTo: panOps.lineTo,
    };
  } finally {
    restoreFrameHost();
    restoreCanvas();
  }
}

/**
 * 格式化毫秒数
 * @param {number} value - 毫秒
 * @returns {string} 定宽字符串
 */
function formatMs(value) {
  return value.toFixed(2).padStart(7);
}

/**
 * 格式化百分比
 * @param {number} ratio - 占比（0~1）
 * @returns {string} 定宽字符串
 */
function formatShare(ratio) {
  if (!Number.isFinite(ratio)) return "      -";
  return `${Math.round(ratio * 100)}%`.padStart(7);
}

/**
 * 按预算判定
 * @param {number} p95 - p95 耗时（毫秒）
 * @param {number | null} budget - 预算（毫秒），null 表示该项不参与判定
 * @returns {boolean} 是否达标
 */
function verdict(p95, budget) {
  if (budget === null) return true;
  return p95 <= budget;
}

/**
 * 判定标签
 * @param {boolean} passed - 是否达标
 * @param {number | null} budget - 预算，null 表示不参与判定
 * @returns {string} 展示用标签
 */
function verdictLabel(passed, budget) {
  if (budget === null) return "N/A";
  return passed ? "PASS" : "FAIL";
}

/**
 * 计算字符串的终端显示宽度
 * @description 中文与全角符号占两列，表格对齐必须按显示宽度而非字符数计算。
 * @param {string} text - 待测文本
 * @returns {number} 显示宽度
 */
function displayWidth(text) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      code >= 0x20000;
    width += isWide ? 2 : 1;
  }
  return width;
}

/**
 * 按显示宽度右侧补空格
 * @param {string} text - 原文本
 * @param {number} width - 目标显示宽度
 * @returns {string} 补齐后的文本
 */
function padDisplay(text, width) {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/**
 * 表格列内容宽度
 * @description 每列单元格的显示宽度；分隔线宽度为内容宽度 + 2（两侧各一个空格）。
 * @type {number[]}
 */
const COLUMN_WIDTHS = Object.freeze([22, 8, 8, 8, 7, 4]);

/**
 * 生成表格边框线
 * @param {string} left - 左边角字符
 * @param {string} middle - 列间连接字符
 * @param {string} right - 右边角字符
 * @returns {string} 边框线
 */
function tableBorder(left, middle, right) {
  return `  ${left}${COLUMN_WIDTHS.map((width) => "─".repeat(width + 2)).join(middle)}${right}`;
}

/**
 * 生成表格数据行
 * @param {string[]} cells - 各列文本
 * @returns {string} 行文本
 */
function tableRow(cells) {
  const padded = cells.map((cell, index) =>
    padDisplay(cell, COLUMN_WIDTHS[index]),
  );
  return `  │ ${padded.join(" │ ")} │`;
}

/**
 * 格式化预算列
 * @param {number | null} budget - 预算毫秒，null 表示不参与判定
 * @returns {string} 定宽字符串
 */
function formatBudget(budget) {
  return budget === null ? "      -" : formatMs(budget);
}

/**
 * 格式化可缺省的毫秒列
 * @param {number | null | undefined} value - 毫秒
 * @returns {string} 定宽字符串
 */
function formatOptionalMs(value) {
  return typeof value === "number" ? formatMs(value) : "      -";
}

/**
 * 打印单个场景的测量表
 * @param {Object} profiles - 各模式测量结果
 * @param {Object} ops - countDrawOperations 的结果
 * @returns {boolean} 该场景是否全部达标
 */
function printScenario(profiles, ops) {
  const { js, raster } = profiles;
  const hasRaster = raster !== null;

  console.log(`\n【${js.label}】`);
  console.log(
    `  已加载区块 ${js.loadedChunkCount} 个 · 静态对象 ${js.staticDrawableCount} 个` +
      ` · 活动对象 ${js.activeDrawableCount} 个 · 总点数 ${js.pointCount.toLocaleString("en-US")}`,
  );
  console.log(tableBorder("┌", "┬", "┐"));
  console.log(
    tableRow(["帧类型", "JS p95", "光栅化", "估算合计", "预算", "判定"]),
  );
  console.log(tableBorder("├", "┼", "┤"));

  // 估算合计 = JS 全链 + 绘制策略光栅化。
  // 两者互不重叠：前者是几何、合图与调度，后者是 canvas 绘制本身。
  // 提交走局部脏区重建、平移走全量重建，光栅化读数各自独立测量，不可复用。
  const commitDrawPart = hasRaster ? raster.rebuildDraw?.p95 ?? 0 : null;
  const panDrawPart = hasRaster ? raster.panDraw?.p95 ?? 0 : null;
  const rows = [
    ["commit", "提交重绘（tile 局部）", WORKER_BUDGET_MS, commitDrawPart, true],
    ["pan", "平移一帧（tile 合成）", WORKER_BUDGET_MS, panDrawPart, true],
    ["output", "输出层单帧（缓存未失效）", WORKER_BUDGET_MS, null, true],
    ["transfer", "帧回传（位图 + 回填）", null, null, false],
  ];

  let passed = true;
  for (const [key, label, budget, rasterPart, judge] of rows) {
    const jsP95 = js[key].p95;
    const estimate = jsP95 + (rasterPart ?? 0);
    const ok = verdict(estimate, budget);
    if (judge && !ok) passed = false;
    const opsKey = key === "commit" ? ops.commitOps : key === "pan" ? ops.panOps : 0;
    const opsLineTo =
      key === "commit" ? ops.commitLineTo : key === "pan" ? ops.panLineTo : 0;
    const opsText =
      opsKey > 0
        ? `${opsKey.toLocaleString("en-US")} (lineTo ${opsLineTo.toLocaleString("en-US")})`
        : "-";
    console.log(
      tableRow([
        label,
        formatMs(jsP95),
        formatOptionalMs(rasterPart),
        formatMs(estimate),
        formatBudget(budget),
        verdictLabel(ok, budget),
      ]),
    );
    if (opsText !== "-") {
      console.log(`    · 绘制调用 / 次：${opsText}`);
    }
    const tileRebuilds =
      key === "commit"
        ? js.commitTileRebuilds
        : key === "pan"
          ? js.panTileRebuilds
          : null;
    if (tileRebuilds !== null && js.tileInfo?.enabled) {
      console.log(
        `    · tile 重建 / 次：${tileRebuilds}（缓存 ${js.tileInfo.tileCount} 块）`,
      );
    }
  }

  const idleOk =
    js.idleFramesProduced === 0 && js.idle.p95 <= IDLE_BUDGET_MS;
  if (!idleOk) passed = false;
  console.log(
    tableRow([
      "空闲帧（不应产出帧）",
      formatMs(js.idle.p95),
      formatOptionalMs(null),
      formatMs(js.idle.p95),
      formatMs(IDLE_BUDGET_MS),
      verdictLabel(idleOk, IDLE_BUDGET_MS),
    ]),
  );
  console.log(tableBorder("└", "┴", "┘"));

  if (hasRaster) {
    console.log(
      `  诊断：光栅模式 flush 全链 p95 = 提交 ${formatMs(raster.commit.p95)} · 平移 ${formatMs(raster.pan.p95)}；` +
        `对象 ${formatMs(raster.drawBreakdown.objectCommit.p95)}+合成 ${formatMs(raster.drawBreakdown.blitCommit.p95)}（提交）· ` +
        `对象 ${formatMs(raster.drawBreakdown.objectPan.p95)}+合成 ${formatMs(raster.drawBreakdown.blitPan.p95)}（平移）。`,
    );
  }

  return passed;
}

/**
 * 加载真实光栅化实现
 * @description 缺失时降级为只跑 JS 侧并明确告警，不静默跳过。
 * @returns {Promise<{ createCanvas: Function } | null>} 真实 canvas 实现
 */
async function loadRasterModule() {
  try {
    return await import("@napi-rs/canvas");
  } catch (error) {
    console.warn(
      `\n未能加载 @napi-rs/canvas，本次跳过光栅化测量：${error?.message ?? error}`,
    );
    return null;
  }
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  printHeader("交互帧预算基准");

  console.log(
    `预算模型：目标 ${TARGET_FPS}fps = ${FRAME_BUDGET_MS.toFixed(2)}ms/帧，` +
      `worker 侧占 ${(WORKER_SHARE * 100).toFixed(0)}% → ${WORKER_BUDGET_MS.toFixed(2)}ms。` +
      `判定取 p95。\n`,
  );

  const rasterModule = await loadRasterModule();
  const rasterFactory = rasterModule
    ? createRasterCanvasFactory(rasterModule)
    : null;

  console.log(
    "口径：JS p95 用空实现上下文，含几何、合图与调度；光栅化只统计绘制策略内部耗时。" +
      "估算合计 = 两者相加，判定以它为准。",
  );
  console.log(
    "不直接用光栅模式的 flush 全链：CPU 光栅器在刷新画布表面时会做惰性展平与内存回收，" +
      "那部分开销落在全链上却不属于绘制，浏览器里也没有。",
  );

  const results = [];
  let allPassed = true;

  for (const scenario of SCENARIOS) {
    const js = await profileScenario(scenario, {
      createCanvasLike: createJsCanvasFactory(),
      sampleConfig: MEASURE_CONFIG[CANVAS_MODES.js],
      measureDraw: false,
    });
    // 经典路径只跑 JS 侧：tile 与全量重建的差别在调度与合图，光栅化面积两者相同
    const classic = await profileScenario(scenario, {
      createCanvasLike: createJsCanvasFactory(),
      sampleConfig: MEASURE_CONFIG[CANVAS_MODES.js],
      measureDraw: false,
      tiles: false,
    });
    const raster = rasterFactory
      ? await profileScenario(scenario, {
          createCanvasLike: rasterFactory,
          sampleConfig: MEASURE_CONFIG[CANVAS_MODES.raster],
          measureDraw: true,
        })
      : null;
    const ops = await countDrawOperations(scenario);

    const passed = printScenario({ js, raster }, ops);
    allPassed = allPassed && passed;
    results.push({ js, classic, raster, ops, passed });
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("规模曲线 · 提交重绘（p95，毫秒）");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(
    "  总点数  │ JS 重建 │ 光栅化 │ 估算合计 │ 占帧   │ 判定",
  );
  let firstOver = null;
  for (const { js, raster } of results) {
    const drawP95 = raster?.rebuildDraw?.p95 ?? 0;
    const estimate = js.commit.p95 + drawP95;
    const over = estimate > WORKER_BUDGET_MS;
    if (over && firstOver === null) {
      firstOver = js.strokeCount;
    }
    console.log(
      `  ${String(js.pointCount).padStart(7)} │ ${formatMs(js.commit.p95)}  │ ` +
        `${formatOptionalMs(raster ? drawP95 : null)} │ ${formatMs(estimate)}  │ ` +
        `${formatShare(estimate / FRAME_BUDGET_MS)} │ ${over ? "超出预算" : "预算内"}`,
    );
  }
  console.log("\n规模曲线 · tile 与经典路径（JS p95，毫秒）");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(
    "  总点数  │ 提交 经典 │ 提交 tile │ 平移 经典 │ 平移 tile",
  );
  for (const { classic, js } of results) {
    console.log(
      `  ${String(js.pointCount).padStart(7)} │ ${formatMs(classic.commit.p95)} │ ` +
        `${formatMs(js.commit.p95)} │ ${formatMs(classic.pan.p95)} │ ${formatMs(js.pan.p95)}`,
    );
  }
  console.log("═══════════════════════════════════════════════════════════");

  // 平移在 tile 路径下按块增量合成，用来对照经典路径的全量重建
  console.log("\n规模曲线 · 平移一帧（p95，毫秒）");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(
    "  总点数  │ JS 全链 │ 光栅化 │ 估算合计 │ 占帧   │ 判定",
  );
  let firstPanOver = null;
  for (const { js, raster } of results) {
    const drawP95 = raster?.panDraw?.p95 ?? 0;
    const estimate = js.pan.p95 + drawP95;
    const over = estimate > WORKER_BUDGET_MS;
    if (over && firstPanOver === null) firstPanOver = js.strokeCount;
    console.log(
      `  ${String(js.pointCount).padStart(7)} │ ${formatMs(js.pan.p95)}  │ ` +
        `${formatOptionalMs(raster ? drawP95 : null)} │ ${formatMs(estimate)}  │ ` +
        `${formatShare(estimate / FRAME_BUDGET_MS)} │ ${over ? "超出预算" : "预算内"}`,
    );
  }
  console.log("═══════════════════════════════════════════════════════════");

  if (allPassed) {
    console.log("\n结论：全部场景在估算合计上仍低于 worker 侧预算。");
  } else if (firstOver !== null) {
    console.log(
      `\n结论：提交路径从 ${firstOver} 笔开始超过 worker 侧预算。`,
    );
  } else {
    console.log(
      "\n结论：提交路径全部在预算内，超预算的是其他帧类型（见各场景判定）。",
    );
  }
  if (firstPanOver !== null) {
    console.log(
      `      平移路径从 ${firstPanOver} 笔开始超过预算。`,
    );
  }

  printFooter();
}

await main();
