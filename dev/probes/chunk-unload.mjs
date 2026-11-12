/**
 * @file 视口缩小再放大后区块是否回落
 * @description 在真实持久化的板上把视口缩到极小再恢复，观察已载区块数与单帧耗时是否回到初始水平。
 * @author Zhou Chenyu
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { openBoardSession } from "../../src/cli/board-session.js";
import { ViewportCore } from "../../src/renderers/canvas/viewport-core.js";

const W = 900, H = 700, STROKES = 800, CHUNK = 1024;
const origOff = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    const c = createCanvas(w, h);
    c.transferToImageBitmap = () => {
      const s = createCanvas(w, h);
      s.getContext("2d").drawImage(c, 0, 0);
      return s;
    };
    return c;
  }
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwb-unload-"));
const created = await openBoardSession(dir, { create: true, width: CHUNK, height: CHUNK });
// 铺开到约 6×6 个区块，保证缩小后窗口覆盖远超初始的区块数
for (let i = 0; i < STROKES; i++) {
  const points = [];
  for (let k = 0; k < 30; k++) points.push({ x: k * 3, y: Math.sin(k) * 18 });
  await created.api.addObject("StrokeObject", {
    position: { x: (i % 29) * 220, y: Math.floor(i / 29) * 220 },
    data: { points },
  });
}
await created.api.flush?.();
await created.close?.();

const reopened = await openBoardSession(dir, { create: false });
const boardCore = reopened.api.getBoardCore?.() ?? reopened.boardCore;
const viewport = new ViewportCore({
  boardCore,
  viewportId: "unload-probe",
  width: W,
  height: H,
  postRenderFrame() {},
  tiles: true,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 采样一次当前状态
 * @param {string} label - 档位标签
 * @returns {Promise<Object>} 采样结果
 */
async function sample(label) {
  viewport.flushRenderFrame();
  await wait(400);
  viewport.flushRenderFrame();
  const t0 = performance.now();
  viewport.onViewportChange({ origin: { x: 50, y: 0 }, zoom: viewport.zoom });
  viewport.flushRenderFrame();
  const frameMs = performance.now() - t0;
  const chunks = viewport.chunkLoader.getLoadedChunks().length;
  const resident = boardCore.objectLoaded?.size ?? -1;
  console.log(`${label.padEnd(22)} 已载区块 ${String(chunks).padStart(6)} | 驻留对象 ${String(resident).padStart(6)} | 一帧 ${frameMs.toFixed(2)}ms`);
  return { chunks, resident, frameMs };
}

viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: 1, viewportSize: { width: W, height: H }, force: true });
await sample("初始 zoom=1");
for (const z of [0.2, 0.05]) {
  viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: z, viewportSize: { width: W, height: H }, force: true });
  await sample(`缩小到 zoom=${z}`);
}
viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: 1, viewportSize: { width: W, height: H }, force: true });
await sample("恢复到 zoom=1");
await wait(2000);
await sample("恢复后 2 秒");

viewport.destroy?.();
await reopened.close?.();
fs.rmSync(dir, { recursive: true, force: true });
globalThis.OffscreenCanvas = origOff;
process.exit(0);
