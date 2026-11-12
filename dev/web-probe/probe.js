/**
 * @file 真机成本测量页
 * @description 在浏览器原生画布上跑与 Node 基线同一份场景，把结果写进表格与 window.__probeResults。
 * @author Zhou Chenyu
 */

import { createFixture, runScenarios, VIEWPORT } from "../probes/scenarios.js";

const statusLine = document.getElementById("status");
const body = document.querySelector("#results tbody");
const capsBox = document.getElementById("caps");
const vis = document.getElementById("vis");

/**
 * 打印能力矩阵
 * @returns {void}
 */
function printCapabilities() {
  const items = {
    OffscreenCanvas: typeof OffscreenCanvas,
    ImageBitmap: typeof ImageBitmap,
    devicePixelRatio: window.devicePixelRatio,
    "视口尺寸": `${VIEWPORT.width}×${VIEWPORT.height}`,
    UA: navigator.userAgent,
  };
  capsBox.textContent = Object.entries(items)
    .map(([key, value]) => `${key}: ${value}`)
    .join("　");
}

/**
 * 把结果行写进表格
 * @param {{ group: string, name: string, p50: number, p95: number }} row - 一行结果
 * @returns {void}
 */
function appendRow(row) {
  const tr = document.createElement("tr");
  const cells = [row.group, row.name, row.p50.toFixed(1), row.p95.toFixed(1)];
  for (const [index, text] of cells.entries()) {
    const cell = document.createElement("td");
    if (index >= 2) cell.className = "ms";
    cell.textContent = index >= 2 ? `${text}ms` : text;
    tr.append(cell);
  }
  body.append(tr);
}

printCapabilities();

if (typeof OffscreenCanvas === "undefined") {
  statusLine.textContent = "当前浏览器没有 OffscreenCanvas，场景无法运行。";
} else {
  const results = await runScenarios({
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
