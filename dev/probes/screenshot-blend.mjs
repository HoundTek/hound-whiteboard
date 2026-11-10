/**
 * @file 判断截图差异是否为全局混合（背景层显隐）
 * @description 对画布区域做逐通道线性回归，并统计差异强度的空间分布。
 * @author zhouc_yu
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";

const files = [
  "/Users/zhouc_yu/Desktop/闪001.png",
  "/Users/zhouc_yu/Desktop/闪002.png",
  "/Users/zhouc_yu/Desktop/闪003.png",
];
const box = { left: 224, top: 216, right: 471, bottom: 445 };
const width = box.right - box.left + 1;
const height = box.bottom - box.top + 1;

/**
 * 读取画布区域像素
 * @param {string} path - 图片路径
 * @returns {Promise<Uint8ClampedArray>} 像素
 */
async function readRegion(path) {
  const image = await loadImage(readFileSync(path));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(box.left, box.top, width, height).data;
}

/**
 * 逐通道最小二乘回归 new = k * old + b
 * @param {Uint8ClampedArray} a - 基准像素
 * @param {Uint8ClampedArray} b - 对比像素
 * @param {number} channel - 通道下标
 * @returns {{ k: number, b: number, r2: number }}
 */
function regress(a, b, channel) {
  const n = a.length / 4;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  let sumYY = 0;
  for (let i = channel; i < a.length; i += 4) {
    const x = a[i];
    const y = b[i];
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
    sumYY += y * y;
  }
  const denom = n * sumXX - sumX * sumX;
  const k = denom === 0 ? 1 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - k * sumX) / n;
  const covXY = n * sumXY - sumX * sumY;
  const varX = n * sumXX - sumX * sumX;
  const varY = n * sumYY - sumY * sumY;
  const r2 = varX === 0 || varY === 0 ? 0 : (covXY * covXY) / (varX * varY);
  return { k, b: intercept, r2 };
}

/**
 * 统计差异像素数量与强度分布
 * @param {Uint8ClampedArray} a - 基准像素
 * @param {Uint8ClampedArray} b - 对比像素
 * @returns {{ changed: number, meanDelta: number, maxDelta: number, brighter: number, darker: number }}
 */
function deltaStats(a, b) {
  let changed = 0;
  let sumDelta = 0;
  let maxDelta = 0;
  let brighter = 0;
  let darker = 0;
  for (let i = 0; i < a.length; i += 4) {
    const lumaA = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
    const lumaB = b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114;
    const delta = lumaB - lumaA;
    if (Math.abs(delta) > 3) {
      changed++;
      sumDelta += delta;
      maxDelta = Math.max(maxDelta, Math.abs(delta));
      if (delta > 0) brighter++;
      else darker++;
    }
  }
  return {
    changed,
    meanDelta: changed === 0 ? 0 : sumDelta / changed,
    maxDelta,
    brighter,
    darker,
  };
}

const regions = [];
for (const file of files) regions.push(await readRegion(file));
const total = regions[0].length / 4;

for (let pair = 0; pair < 2; pair++) {
  const a = regions[pair];
  const b = regions[pair + 1];
  const stats = deltaStats(a, b);
  console.log(`\n=== 闪00${pair + 1} → 闪00${pair + 2} ===`);
  console.log(
    `  差异像素=${stats.changed}/${total}（${((stats.changed / total) * 100).toFixed(1)}%）` +
      ` 变暗=${stats.darker} 变亮=${stats.brighter} 均值Δ=${stats.meanDelta.toFixed(2)} 最大|Δ|=${stats.maxDelta.toFixed(0)}`,
  );
  for (const [name, channel] of [
    ["R", 0],
    ["G", 1],
    ["B", 2],
  ]) {
    const { k, b: offset, r2 } = regress(a, b, channel);
    console.log(
      `  ${name}: new = ${k.toFixed(3)} * old ${offset >= 0 ? "+" : "-"} ${Math.abs(offset).toFixed(1)}   R²=${r2.toFixed(3)}`,
    );
  }
}
