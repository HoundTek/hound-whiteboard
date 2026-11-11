/**
 * @file 区块尺寸的选取依据
 * @description 量三件事：窗口内区块数、单区块元数据读取成本、单区块对象载入成本，用于选默认区块尺寸。
 * @author Zhou Chenyu
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoardSession } from "../../src/cli/board-session.js";
import { createSessionStore } from "../../src/kernel/store/session-store.js";
import { createNodeDriver } from "../../src/io/driver/node.js";
import { bindRoot } from "../../src/io/driver/io-driver.js";
import { createPersistenceAdapter } from "../../src/io/adapter/persistence.js";
import { ChunkObjectManager } from "../../src/kernel/chunk/chunk-object-manager.js";
import { RectangleRange } from "../../src/kernel/range/index.js";

const VIEW_W = 900;
const VIEW_H = 700;
const ZOOMS = [1, 0.5, 0.1];
const CANDIDATES = [
  { label: "900x700(现状)", w: 900, h: 700 },
  { label: "1024x1024", w: 1024, h: 1024 },
  { label: "2048x2048", w: 2048, h: 2048 },
  { label: "4096x4096", w: 4096, h: 4096 },
];

/**
 * 计算视口加载窗口（视口世界矩形 2 倍）覆盖的区块数
 * @param {number} chunkW - 区块宽
 * @param {number} chunkH - 区块高
 * @param {number} zoom - 缩放
 * @returns {number} 区块数
 */
function windowChunkCount(chunkW, chunkH, zoom) {
  const worldW = VIEW_W / zoom;
  const worldH = VIEW_H / zoom;
  const rect = new RectangleRange(
    -worldW / 2,
    -worldH / 2,
    worldW * 2,
    worldH * 2,
  );
  return ChunkObjectManager.calculateCoveredChunkIdsForRange(rect, chunkW, chunkH)
    .size;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwb-chunk-size-"));
const boardDir = path.join(tmp, "board");
fs.mkdirSync(boardDir, { recursive: true });

// 建一块 3000 笔迹的真实文件板
const OBJECT_COUNT = 3000;
const session = await openBoardSession(boardDir, {
  create: true,
  width: VIEW_W,
  height: VIEW_H,
});
for (let i = 0; i < OBJECT_COUNT; i++) {
  const points = [];
  for (let k = 0; k < 30; k++) points.push({ x: k * 3, y: Math.sin(k) * 18 });
  await session.api.addObject("StrokeObject", {
    position: { x: (i % 22) * 40, y: Math.floor(i / 22) * 40 },
    data: { points },
  });
}
await session.close?.();

const driver = bindRoot(createNodeDriver(boardDir), "local");
const store = createSessionStore(driver);

/** 生成 K 个区块元数据文件（每个含约 650 个对象 id，模拟真实层叠图） */
const writeChunkMeta = async (count, objectsPerChunk) => {
  await driver.mkdir("chunks");
  for (let i = 1; i <= count; i++) {
    const ids = Array.from({ length: objectsPerChunk }, (_, k) => `fake/${i}-${k}`);
    const nodes = ids.map((id) => [id, []]);
    await driver.write(
      `chunks/${i}.json`,
      JSON.stringify({ tierGraph: nodes, objectCoverIndex: [] }),
    );
  }
};

const clearChunkMeta = async () => {
  const entries = await driver.ls("chunks");
  for (const entry of entries) {
    if (entry.isFile) await driver.rm(`chunks/${entry.name}`);
  }
};

console.log("## 1. 加载窗口内的区块数（窗口 = 视口世界矩形 2 倍）");
console.log("chunk 尺寸 | zoom=1 | zoom=0.5 | zoom=0.1");
for (const c of CANDIDATES) {
  const counts = ZOOMS.map((z) => windowChunkCount(c.w, c.h, z));
  console.log(
    `${c.label.padEnd(14)} | ${counts.map((n) => String(n).padStart(6)).join(" | ")}`,
  );
}

console.log("\n## 2. 读取全部区块元数据的耗时（每个约 650 个对象 id）");
console.log("区块数 | 读取耗时");
for (const count of [63, 252, 441, 1024]) {
  await clearChunkMeta();
  await writeChunkMeta(count, 650);
  const t0 = performance.now();
  const list = await store.readAllChunkMetadata();
  const ms = performance.now() - t0;
  console.log(`${String(count).padStart(6)} | ${ms.toFixed(1).padStart(6)}ms (实读 ${list.length})`);
}
await clearChunkMeta();

console.log("\n## 3. 单区块对象载入成本（真实对象文件：读盘 + 反序列化 + 注册）");
console.log("批量对象数 | 读盘+反序列化 | 单对象均摊");

// board-session 默认装配的是空适配器，这里用真实驱动构造真实适配器
const adapter = createPersistenceAdapter({
  driver: createNodeDriver(boardDir),
  rootId: "local",
});
for (const batch of [100, 650, 2600]) {
  const ids = Array.from({ length: batch }, (_, i) => `cli/${i + 1}`);
  const t0 = performance.now();
  const data = await adapter.loadObjects(ids);
  const readMs = performance.now() - t0;
  console.log(
    `${String(batch).padStart(10)} | ${readMs.toFixed(1).padStart(12)}ms | ${((readMs / batch) * 1000).toFixed(0).padStart(8)}µs`,
  );
  void data;
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
