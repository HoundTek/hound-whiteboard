/**
 * @file 交互帧预算基准
 * @description 在真实区块加载路径上测量提交重绘、平移帧、空闲帧与帧回传的 worker 侧耗时，并按 60fps 预算逐项判定。
 * @module benchmarks/interaction-frame
 * @author Zhou Chenyu
 */

import { BoardCore } from "../src/kernel/board/board-core.js";
import { ViewportCore } from "../src/renderers/canvas/viewport-core.js";
import { StrokeObject } from "../src/kernel/objects/stroke/stroke.js";
import { Vector } from "../src/kernel/utils/math.js";
import { RectangleRange } from "../src/kernel/range/rectangle.js";
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
 * 每个采样批次内的迭代次数
 * @type {number}
 */
const BATCH_ITERATIONS = 8;

/**
 * 采样批次数
 * @type {number}
 */
const BATCH_COUNT = 25;

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
  const batches = options.batches ?? BATCH_COUNT;
  const iterations = options.iterations ?? BATCH_ITERATIONS;
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
 * 创建快速空实现 2D 上下文
 * @description 计时用的上下文必须没有任何拦截开销，否则测到的会是拦截器成本而非渲染管线成本。
 * @returns {CanvasRenderingContext2D} 空实现上下文
 */
function createFastContext() {
  return createNoopCanvasContext2D();
}

/**
 * 创建带调用计数的 2D 上下文
 * @description 只用于统计绘制调用量，不参与计时——Proxy 拦截本身有显著开销。
 * @returns {{ ctx: CanvasRenderingContext2D, counts: Record<string, number> }} 计数上下文
 */
function createCountingContext() {
  const counts = Object.create(null);
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        return (...args) => {
          counts[prop] = (counts[prop] ?? 0) + 1;
          return prop === "measureText" ? { width: 0 } : undefined;
        };
      },
      set() {
        return true;
      },
    },
  );
  return { ctx, counts };
}

/**
 * 安装 canvas 工厂
 * @description 同时接管 OffscreenCanvas 构造器，使 ViewportCore 的缓存层与输出层都使用同一上下文。
 * @param {() => CanvasRenderingContext2D} createContext - 上下文工厂
 * @returns {() => void} 恢复函数
 */
function installCanvasFactory(createContext) {
  const previous = globalThis.OffscreenCanvas;
  const context = createContext();

  globalThis.OffscreenCanvas = function OffscreenCanvas(width, height) {
    return {
      width,
      height,
      getContext: () => context,
      transferToImageBitmap: () => ({ width, height, close() {} }),
    };
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
 * @description 让不同轮次、不同规模的场景使用同一套笔迹形状，避免形状差异污染对比。
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
 * @param {{ seed?: number, activeStrokes?: number }} [options={}] - 夹具选项
 * @returns {Promise<{
 *   boardCore: BoardCore,
 *   viewport: ViewportCore,
 *   renderer: import("../src/renderers/canvas/viewport-renderer.js").ViewportRenderer,
 *   staticDrawableCount: number,
 *   activeDrawableCount: number,
 *   loadedChunkCount: number,
 *   frames: Array<Object>,
 *   sampleStroke: StrokeObject,
 * }>} 夹具
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
 * @returns {Promise<Object>} 测量结果
 */
async function profileScenario(scenario) {
  const restoreCanvas = installCanvasFactory(createFastContext);
  const restoreFrameHost = installFrameHost();

  try {
    const fixture = await buildFixture(scenario);
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
      renderer.flush([]);
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
      panOriginX += panDirection;
      if (panOriginX >= 4) panDirection = -1;
      if (panOriginX <= -4) panDirection = 1;
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

    const idleFramesBefore = frames.length;
    const idle = measure(idleFrame);
    const idleFramesProduced = frames.length - idleFramesBefore;

    const transferFrame = () => {
      viewport.markFrameDirty();
      viewport.flushRenderFrame();
    };

    const commit = measure(commitRedraw);
    const output = measure(outputFrame);
    const pan = measure(panFrame);
    const transfer = measure(transferFrame);

    return {
      label: `${scenario.strokes} 笔 × ${scenario.points} 点`,
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
      idleFramesProduced,
    };
  } finally {
    restoreFrameHost();
    restoreCanvas();
  }
}

/**
 * 统计绘制调用量
 * @description 计时用的空上下文不产生光栅化，这里单独统计 canvas 调用次数，
 * 作为「未被计时覆盖的光栅化负载」指标报告。
 * @param {{ strokes: number, points: number }} scenario - 场景规模
 * @returns {Promise<{ commitOps: number, panOps: number, lineTo: number }>} 调用量
 */
async function countDrawOperations(scenario) {
  const counter = createCountingContext();
  const restoreCanvas = installCanvasFactory(() => counter.ctx);
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
    renderer.flush([]);
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
const COLUMN_WIDTHS = Object.freeze([24, 7, 7, 7, 26, 4]);

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
  const padded = cells.map((cell, index) => padDisplay(cell, COLUMN_WIDTHS[index]));
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
 * 打印单个场景的测量表
 * @param {Object} result - profileScenario 的结果
 * @param {Object} ops - countDrawOperations 的结果
 * @returns {boolean} 该场景是否全部达标
 */
function printScenario(result, ops) {
  console.log(`\n【${result.label}】`);
  console.log(
    `  已加载区块 ${result.loadedChunkCount} 个 · 静态对象 ${result.staticDrawableCount} 个` +
      ` · 活动对象 ${result.activeDrawableCount} 个 · 总点数 ${result.pointCount.toLocaleString("en-US")}`,
  );
  console.log(tableBorder("┌", "┬", "┐"));
  console.log(
    tableRow(["帧类型", "p50(ms)", "p95(ms)", "预算", "绘制调用/次", "判定"]),
  );
  console.log(tableBorder("├", "┼", "┤"));

  const rows = [
    ["提交后静态缓存重建", result.commit, WORKER_BUDGET_MS, ops.commitOps, ops.commitLineTo],
    ["平移一帧（worker 全链）", result.pan, WORKER_BUDGET_MS, ops.panOps, ops.panLineTo],
    ["输出层单帧（缓存未失效）", result.output, WORKER_BUDGET_MS, 0, 0],
    ["帧回传（位图 + 回填）", result.transfer, null, 0, 0],
  ];

  let passed = true;
  for (const [label, stats, budget, opsCount, lineTo] of rows) {
    const ok = verdict(stats.p95, budget);
    if (!ok) passed = false;
    const opsText =
      opsCount > 0
        ? `${opsCount.toLocaleString("en-US")} (lineTo ${lineTo.toLocaleString("en-US")})`
        : "-";
    console.log(
      tableRow([
        label,
        formatMs(stats.p50),
        formatMs(stats.p95),
        formatBudget(budget),
        opsText,
        verdictLabel(ok, budget),
      ]),
    );
  }

  const idleOk =
    result.idleFramesProduced === 0 && result.idle.p95 <= IDLE_BUDGET_MS;
  if (!idleOk) passed = false;
  console.log(
    tableRow([
      "空闲帧（不应产出帧）",
      formatMs(result.idle.p50),
      formatMs(result.idle.p95),
      formatMs(IDLE_BUDGET_MS),
      `产出 ${result.idleFramesProduced} 帧`,
      verdictLabel(idleOk, IDLE_BUDGET_MS),
    ]),
  );
  console.log(tableBorder("└", "┴", "┘"));

  return passed;
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
  console.log(
    "测量边界：使用空实现 2D 上下文，因此只覆盖 worker 侧的 JavaScript、几何与调度成本，" +
      "不含 canvas 光栅化。绘制调用量单独统计，作为未计入部分的下界参考；" +
      "「帧回传」行的主要成本是全画布位图搬运，空上下文下无意义，故不参与判定。",
  );

  const results = [];
  let allPassed = true;

  for (const scenario of SCENARIOS) {
    const profile = await profileScenario(scenario);
    const ops = await countDrawOperations(scenario);
    const passed = printScenario(profile, ops);
    allPassed = allPassed && passed;
    results.push({ profile, ops, passed });
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("规模曲线（p95，毫秒）");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(
    "  总点数  │ 提交重建 │ 平移一帧 │ 输出层 │ 判定",
  );
  let firstOver = null;
  for (const { profile } of results) {
    const over =
      profile.commit.p95 > WORKER_BUDGET_MS ||
      profile.pan.p95 > WORKER_BUDGET_MS;
    if (over && firstOver === null) {
      firstOver = profile.strokeCount;
    }
    console.log(
      `  ${String(profile.pointCount).padStart(7)} │ ${formatMs(profile.commit.p95)}  │ ${formatMs(profile.pan.p95)}  │ ${formatMs(profile.output.p95)} │ ${over ? "超出预算" : "预算内"}`,
    );
  }
  console.log("═══════════════════════════════════════════════════");

  if (allPassed) {
    console.log("\n结论：全部场景在预算内。静态缓存重建尚未构成瓶颈。");
  } else {
    console.log(
      `\n结论：从 ${firstOver} 笔开始，提交与平移帧的 worker 侧耗时就已吃掉半数以上帧预算。`,
    );
    console.log(
      "      该规模下平移/缩放与连续落笔无法守住目标帧率，且上述数字尚未计入 canvas 光栅化。",
    );
  }

  printFooter();
}

await main();
