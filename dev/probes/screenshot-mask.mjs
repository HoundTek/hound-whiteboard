/**
 * @file 判断截图差异是矩形块（tile 级丢失）还是沿笔画形状（内容不同）
 * @description 对每一对截图统计 ink 掩码的差集，并给出包围盒填充率。
 * @author zhouc_yu
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";

const files = [
  "/Users/zhouc_yu/Desktop/闪001.png",
  "/Users/zhouc_yu/Desktop/闪002.png",
  "/Users/zhouc_yu/Desktop/闪003.png",
];

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

const box = { left: 224, top: 216, right: 471, bottom: 445 };
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
