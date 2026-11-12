/**
 * @file 判断截图差异是否为全局混合（背景层显隐）
 * @description 对画布区域做逐通道线性回归，并统计差异强度的空间分布。
 * @author Zhou Chenyu
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";

/**
 * 从命令行参数取得三张对比截图
 * @description 用法为 node <script>.mjs a.png b.png c.png，缺参数时打印用法并退出。
 * @returns {string[]} 截图路径
 */
function resolveFiles() {
  const files = process.argv.slice(2);
  if (files.length < 3) {
    console.error("用法: node " + process.argv[1] + " <第一帧.png> <第二帧.png> <第三帧.png>");
    console.error("另可用 BOX=left,top,right,bottom 指定画布区域");
    process.exit(1);
  }
  return files.slice(0, 3);
}

/**
 * 取得画布区域
 * @description 默认值为已知样本的位置，用 BOX 环境变量覆盖。
 * @returns {{ left: number, top: number, right: number, bottom: number }} 区域
 */
function resolveBox() {
  const raw = process.env.BOX;
  if (!raw) return { left: 224, top: 216, right: 471, bottom: 445 };
  const parts = raw.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    console.error("BOX 需要四个逗号分隔的数字，例如 BOX=224,216,471,445");
    process.exit(1);
  }
  const [left, top, right, bottom] = parts;
  return { left, top, right, bottom };
}

const files = resolveFiles();
const box = resolveBox();
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
