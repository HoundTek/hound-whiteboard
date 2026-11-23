/**
 * @file 真机成本测量页
 * @description 在浏览器原生画布上跑与 Node 基线同一份场景，把结果写进表格与 window.__probeResults；`?mode=zoom-chain` 切到连续缩小探针。
 * @author Zhou Chenyu
 */

import { createFixture, DEFAULT_SWEEP, runScenarios, SWEEPS, VIEWPORT } from "../probes/scenarios.js";
import { runZoomChain, VIEWPORT as CHAIN_VIEWPORT } from "./zoom-chain.js";

const statusLine = document.getElementById("status");
const head = document.querySelector("#results thead");
const body = document.querySelector("#results tbody");
const capsBox = document.getElementById("caps");
const vis = document.getElementById("vis");

/**
 * 打印能力矩阵
 * @param {{ width: number, height: number }} viewport - 当前模式的视口尺寸
 * @returns {void}
 */
function printCapabilities(viewport) {
  const items = {
    OffscreenCanvas: typeof OffscreenCanvas,
    ImageBitmap: typeof ImageBitmap,
    devicePixelRatio: window.devicePixelRatio,
    "视口尺寸": `${viewport.width}×${viewport.height}`,
    UA: navigator.userAgent,
  };
  capsBox.textContent = Object.entries(items)
    .map(([key, value]) => `${key}: ${value}`)
    .join("　");
}

/**
 * 替换结果表头
 * @param {string[]} labels - 表头文字
 * @param {number} [numericFrom=2] - 从此下标起右对齐
 * @returns {void}
 */
function setHeaders(labels, numericFrom = 2) {
  const row = document.createElement("tr");
  for (const [index, text] of labels.entries()) {
    const cell = document.createElement("th");
    if (index >= numericFrom) cell.className = "ms";
    cell.textContent = text;
    row.append(cell);
  }
  head.replaceChildren(row);
}

/**
 * 追加一行结果
 * @param {Array<string|number>} values - 单元格内容
 * @param {number} [numericFrom=values.length] - 从此下标起右对齐
 * @returns {void}
 */
function appendCells(values, numericFrom = values.length) {
  const tr = document.createElement("tr");
  for (const [index, value] of values.entries()) {
    const cell = document.createElement("td");
    if (index >= numericFrom) cell.className = "ms";
    cell.textContent = String(value);
    tr.append(cell);
  }
  body.append(tr);
}

/**
 * 把场景结果行写进表格
 * @param {{ group: string, name: string, p50: number, p95: number }} row - 一行结果
 * @returns {void}
 */
function appendRow(row) {
  appendCells(
    [row.group, row.name, `${row.p50.toFixed(1)}ms`, `${row.p95.toFixed(1)}ms`],
    2,
  );
}

/**
 * 把连续缩小结果行写进表格
 * @param {Object} row - 一步结果
 * @returns {void}
 */
function appendZoomRow(row) {
  appendCells(
    [
      row.step,
      row.zoom.toFixed(3),
      `[${row.layerZooms.map((zoom) => zoom.toFixed(2)).join(", ")}]`,
      row.prefetchDelta,
      row.rebuildDelta,
      row.rebuildTotal,
      `${(row.bytes / (1024 * 1024)).toFixed(1)}MB`,
      `${row.frameMs.toFixed(1)}ms`,
      `${(row.coverage * 100).toFixed(1)}%`,
    ],
    3,
  );
}

const params = new URLSearchParams(location.search);
const mode = params.get("mode");
printCapabilities(mode === "zoom-chain" ? CHAIN_VIEWPORT : VIEWPORT);

if (typeof OffscreenCanvas === "undefined") {
  statusLine.textContent = "当前浏览器没有 OffscreenCanvas，场景无法运行。";
} else if (mode === "zoom-chain") {
  setHeaders(
    ["步骤", "缩放", "层倍率", "预建", "重建增量", "重建总数", "缓存合计", "帧耗时", "覆盖率"],
    3,
  );
  statusLine.textContent = "连续缩小探针准备中…";

  const { rows, canvas } = await runZoomChain({
    onStep(row) {
      appendZoomRow(row);
      statusLine.textContent = `步骤 ${row.step}：缩放 ${row.zoom.toFixed(
        2,
      )}，覆盖率 ${(row.coverage * 100).toFixed(1)}%`;
    },
  });

  window.__zoomChainResults = {
    ua: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: CHAIN_VIEWPORT,
    results: rows,
  };
  statusLine.textContent = "完成。window.__zoomChainResults 可直接复制。";

  vis.width = canvas.width;
  vis.height = canvas.height;
  vis.getContext("2d").drawImage(canvas, 0, 0);
} else {
  // 用 ?sweep=points 切换成点数扫描，默认对象数扫描
  const sweepName = params.get("sweep") ?? DEFAULT_SWEEP;
  const sweep = SWEEPS[sweepName] ?? SWEEPS[DEFAULT_SWEEP];
  statusLine.textContent = `扫描：${sweepName}（${sweep.length} 组）`;

  const results = await runScenarios({
    sweep: sweepName,
    onProgress(row) {
      appendRow(row);
      statusLine.textContent = `${row.group}｜${row.name} 完成`;
    },
  });

  window.__probeResults = {
    ua: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: VIEWPORT,
    results,
  };
  statusLine.textContent = "完成。window.__probeResults 可直接复制。";

  // 把场景渲染结果贴出来，肉眼确认确实画出了内容
  const fixture = await createFixture({ tiles: true });
  vis.width = VIEWPORT.width;
  vis.height = VIEWPORT.height;
  vis.getContext("2d").drawImage(fixture.renderer.canvas, 0, 0);
}
