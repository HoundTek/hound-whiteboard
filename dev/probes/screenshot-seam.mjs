/**
 * @file 在三张截图中寻找 tile 边界特征（贯穿整片的直线分割）
 * @description 逐列/逐行统计相邻截图的差异，若 tile 边界问题存在，差异会集中在单列或单行。
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

/**
 * 读取截图的像素
 * @param {string} path - 图片路径
 * @returns {Promise<{ width: number, height: number, data: Uint8ClampedArray }>}
 */
async function readPixels(path) {
  const image = await loadImage(readFileSync(path));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

/**
 * 计算画布区域，内容为非背景色（白板区域）的包围盒
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} image - 像素
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
function findCanvasRegion(image) {
  const { width, height, data } = image;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const isInk =
        data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245;
      if (!isInk) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { left, top, right, bottom };
}

const images = [];
for (const file of files) images.push(await readPixels(file));

const region = findCanvasRegion(images[0]);
console.log(
  `截图尺寸=${images[0].width}x${images[0].height} 非背景包围盒=(${region.left},${region.top})-(${region.right},${region.bottom})`,
);

/**
 * 逐列统计两图差异
 * @param {{ width: number, data: Uint8ClampedArray }} a - 基准
 * @param {{ width: number, data: Uint8ClampedArray }} b - 对比
 * @param {{ left: number, top: number, right: number, bottom: number }} box - 统计区域
 * @returns {{ colDiff: number[], rowDiff: number[] }}
 */
function diffProfile(a, b, box) {
  const colDiff = new Array(box.right - box.left + 1).fill(0);
  const rowDiff = new Array(box.bottom - box.top + 1).fill(0);
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const i = (y * a.width + x) * 4;
      let diff = 0;
      for (let c = 0; c < 3; c++) {
        diff = Math.max(diff, Math.abs(a.data[i + c] - b.data[i + c]));
      }
      if (diff <= 4) continue;
      colDiff[x - box.left] += diff;
      rowDiff[y - box.top] += diff;
    }
  }
  return { colDiff, rowDiff };
}

/**
 * 找出剖面里的尖峰（远高于中位数）
 * @param {number[]} profile - 剖面
 * @returns {Array<{ index: number, value: number }>}
 */
function peaks(profile) {
  const sorted = [...profile].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const result = [];
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > median * 3 && profile[i] > 0) {
      result.push({ index: i, value: profile[i] });
    }
  }
  return result;
}

for (let pair = 0; pair < 2; pair++) {
  const a = images[pair];
  const b = images[pair + 1];
  const { colDiff, rowDiff } = diffProfile(a, b, region);
  const colPeaks = peaks(colDiff);
  const rowPeaks = peaks(rowDiff);
  const colTotal = colDiff.reduce((sum, value) => sum + value, 0);
  console.log(
    `\n闪00${pair + 1} → 闪00${pair + 2}：差异总量=${colTotal}`,
  );
  console.log(
    `  列尖峰（疑似竖直线）：${colPeaks.length === 0 ? "无" : colPeaks.map((p) => `${region.left + p.index}(${p.value})`).join(", ")}`,
  );
  console.log(
    `  行尖峰（疑似水平线）：${rowPeaks.length === 0 ? "无" : rowPeaks.map((p) => `${region.top + p.index}(${p.value})`).join(", ")}`,
  );
}
