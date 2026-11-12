/**
 * @file 判断截图差异是矩形块（tile 级丢失）还是沿笔画形状（内容不同）
 * @description 对每一对截图统计 ink 掩码的差集，并给出包围盒填充率。
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
 * 读取截图并转换为 ink 掩码
 * @param {string} path - 图片路径
 * @param {{ left: number, top: number, right: number, bottom: number }} box - 画布区域
 * @returns {Promise<Uint8Array>} 二值掩码
 */
async function readMask(path, box) {
  const image = await loadImage(readFileSync(path));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const width = box.right - box.left + 1;
  const height = box.bottom - box.top + 1;
  const { data } = ctx.getImageData(box.left, box.top, width, height);
  // 白板底为近白，笔画有显著色偏；用饱和度与亮度双阈值
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturated = max - min > 18;
    const dark = max < 236;
    mask[p] = saturated || dark ? 1 : 0;
  }
  return mask;
}

/**
 * 统计差集的包围盒与填充率
 * @param {Uint8Array} a - 掩码 A
 * @param {Uint8Array} b - 掩码 B
 * @param {number} width - 宽
 * @param {number} height - 高
 * @returns {{ onlyA: Object, onlyB: Object }}
 */
function differenceBox(a, b, width, height) {
  /**
   * 计算 one 有而 other 无的集合统计
   * @param {Uint8Array} one - 主掩码
   * @param {Uint8Array} other - 对比掩码
   * @returns {Object} 统计结果
   */
  const collect = (one, other) => {
    let count = 0;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!one[p] || other[p]) continue;
        count++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) return { count: 0, box: "无", fill: 0 };
    const boxArea = (right - left + 1) * (bottom - top + 1);
    return {
      count,
      box: `(${left},${top})-(${right},${bottom}) ${right - left + 1}x${bottom - top + 1}`,
      fill: count / boxArea,
    };
  };
  return { onlyA: collect(a, b), onlyB: collect(b, a) };
}

/**
 * 生成差异掩码的字符画
 * @param {Uint8Array} a - 掩码 A
 * @param {Uint8Array} b - 掩码 B
 * @param {number} width - 宽
 * @param {number} height - 高
 * @returns {string} 字符画
 */
function asciiDiff(a, b, width, height) {
  const cols = 40;
  const rows = 18;
  const lines = [];
  for (let row = 0; row < rows; row++) {
    let line = "";
    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor((col * width) / cols);
      const x1 = Math.floor(((col + 1) * width) / cols);
      const y0 = Math.floor((row * height) / rows);
      const y1 = Math.floor(((row + 1) * height) / rows);
      let onlyA = 0;
      let onlyB = 0;
      let both = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * width + x;
          if (a[p] && b[p]) both++;
          else if (a[p]) onlyA++;
          else if (b[p]) onlyB++;
        }
      }
      const total = Math.max(1, onlyA + onlyB + both);
      if ((onlyA + onlyB) / total < 0.02) line += both > 0 ? "=" : " ";
      else if (onlyA > onlyB * 2) line += "A";
      else if (onlyB > onlyA * 2) line += "B";
      else line += "x";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

const box = resolveBox();
const width = box.right - box.left + 1;
const height = box.bottom - box.top + 1;
const masks = [];
for (const file of files) masks.push(await readMask(file, box));

for (let pair = 0; pair < 2; pair++) {
  const a = masks[pair];
  const b = masks[pair + 1];
  const { onlyA, onlyB } = differenceBox(a, b, width, height);
  const inkA = a.reduce((sum, value) => sum + value, 0);
  const inkB = b.reduce((sum, value) => sum + value, 0);
  console.log(`\n=== 闪00${pair + 1} vs 闪00${pair + 2} ===`);
  console.log(`ink 像素：${inkA} vs ${inkB}（${(((inkB - inkA) / inkA) * 100).toFixed(1)}%）`);
  console.log(
    `仅前者有：${onlyA.count} 像素，包围盒 ${onlyA.box}，填充率 ${(onlyA.fill * 100).toFixed(1)}%`,
  );
  console.log(
    `仅后者有：${onlyB.count} 像素，包围盒 ${onlyB.box}，填充率 ${(onlyB.fill * 100).toFixed(1)}%`,
  );
  console.log(asciiDiff(a, b, width, height));
}
