/**
 * @file Node 侧的场景基线
 * @description 用 @napi-rs/canvas 充当画布实现，跑与浏览器探针页同一份场景，产出对照数字。
 * @author Zhou Chenyu
 */

import { createCanvas } from "@napi-rs/canvas";

globalThis.OffscreenCanvas = class OffscreenCanvas {
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

const { runScenarios } = await import("./scenarios.js");

console.log(`引擎：${process.version} + @napi-rs/canvas\n`);
const rows = await runScenarios();
console.log("\n配置｜场景｜p50｜p95（毫秒）");
for (const { group, name, p50, p95 } of rows) {
  console.log(`  ${group.padEnd(28)} ${name.padEnd(14)} ${p50.toFixed(1).padStart(6)} ${p95.toFixed(1).padStart(6)}`);
}
process.exit(0);
