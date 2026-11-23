/**
 * @file 浏览器端连续缩小探针
 * @description 在原生画布上复现粗层预建与覆盖率测量，供 Safari 真机调参。
 * @author Zhou Chenyu
 */

import { BoardCore } from "../../src/kernel/board/board-core.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";
import { StrokeObject } from "../../src/kernel/objects/stroke/stroke.js";
import { CircleObject } from "../../src/kernel/objects/graph/circle.js";
import { Vector } from "../../src/kernel/utils/math.js";
import { installRenderHooks, syncRaster } from "../probes/scenarios.js";

/**
 * 探针视口尺寸（CSS 像素）
 * @type {{ width: number, height: number }}
 */
export const VIEWPORT = Object.freeze({ width: 900, height: 700 });

/**
 * 夹具笔迹数
 * @type {number}
 */
const STROKE_COUNT = 600;

/**
 * 每步缩放倍率
 * @type {number}
 */
const ZOOM_STEP = 0.9;

/**
 * 连续缩小步数
 * @type {number}
 */
const STEP_COUNT = 8;

/**
 * 统计输出画布不透明像素占比
 * @param {Object} renderer - 渲染器
 * @returns {number} 0 到 1
 */
function opaqueRatio(renderer) {
  const canvas = renderer.canvas;
  const { width, height } = canvas;
  const data = canvas
    .getContext("2d")
    .getImageData(0, 0, width, height).data;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) opaque++;
  }
  return opaque / (width * height);
}

/**
 * 建立铺满视口的夹具
 * @returns {Promise<{ viewport: Object, renderer: Object }>} 视口与渲染器
 */
async function setup() {
  const boardCore = new BoardCore({ width: 1024, height: 1024 });
  const viewport = new ViewportCore({
    boardCore,
    viewportId: "zoom-chain",
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    postRenderFrame() {},
    tiles: true,
    devicePixelRatio: window.devicePixelRatio || 1,
  });
  const renderer = viewport.renderer;
  installRenderHooks(viewport, boardCore);
  const aom = boardCore.activeObjectManager;

  // 铺满视口，任何未绘制区域都会露成透明
  const cover = new CircleObject(1, new Vector(0, 0), {
    strokeColor: "#111111",
    fillColor: "#111111",
    strokeWidth: 4,
  });
  cover.data.radius = 4000;
  cover.calculateRectangle?.();
  boardCore.registerObjectInstance(cover);
  aom.add([cover]);
  aom.apply([cover]);

  for (let i = 0; i < STROKE_COUNT; i++) {
    const points = [];
    for (let k = 0; k < 30; k++) {
      points.push({ x: k * 3, y: Math.sin(k) * 18 });
    }
    const stroke = new StrokeObject(
      i + 2,
      new Vector((i % 22) * 40, Math.floor(i / 22) * 40),
      { color: "#222", width: 3 },
      { points },
    );
    boardCore.registerObjectInstance(stroke);
    aom.add([stroke]);
    aom.apply([stroke]);
  }

  viewport.onViewportChange({
    origin: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: VIEWPORT,
    force: true,
  });
  viewport.flushRenderFrame();
  await new Promise((resolve) => setTimeout(resolve, 200));
  viewport.flushRenderFrame();
  return { viewport, renderer };
}

/**
 * 运行连续缩小探针
 * @param {{ onStep?: (row: Object) => void }} [options={}] - 每步回调
 * @returns {Promise<{ rows: Array<Object>, canvas: Object }>} 每步结果与最终画布
 */
export async function runZoomChain(options = {}) {
  const { viewport, renderer } = await setup();
  const rows = [];
  let zoom = 1;
  try {
    for (let step = 1; step <= STEP_COUNT; step++) {
      const before = renderer.getTileDebugInfo();
      zoom *= ZOOM_STEP;
      const start = performance.now();
      viewport.onViewportChange({
        origin: viewport.origin,
        zoom,
      });
      viewport.flushRenderFrame();
      syncRaster(renderer);
      const frameMs = performance.now() - start;
      const info = renderer.getTileDebugInfo();
      const row = {
        step,
        zoom,
        layerZooms: info.layerZooms,
        prefetchDelta: info.prefetchCount - before.prefetchCount,
        prefetchTotal: info.prefetchCount,
        rebuildDelta: info.rebuildCount - before.rebuildCount,
        rebuildTotal: info.rebuildCount,
        bytes: info.bytes,
        frameMs,
        coverage: opaqueRatio(renderer),
      };
      rows.push(row);
      options.onStep?.(row);
    }
  } finally {
    viewport.destroy?.();
  }
  return { rows, canvas: renderer.canvas };
}
