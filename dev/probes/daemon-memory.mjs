/**
 * @file daemon 常驻持板的内存占用
 * @description 建板写入 N 条笔迹后重新打开会话，测量反序列化后的堆占用与对象驻留数；
 * `--owner-cache` 模式按 daemon 的部分驻留路径打开并挂上区块缓存。
 * @author Zhou Chenyu
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoardSession } from "../../src/cli/board-session.js";
import { createOwnerResidencyCache } from "../../src/kernel/board/residency-cache.js";

/**
 * 建一块含 N 条笔迹的临时板
 * @param {number} strokeCount - 笔迹数
 * @returns {Promise<string>} 板目录
 */
async function seedBoard(strokeCount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hwb-mem-${strokeCount}-`));
  const created = await openBoardSession(dir, {
    create: true,
    width: 900,
    height: 700,
  });
  for (let i = 0; i < strokeCount; i++) {
    const points = [];
    for (let k = 0; k < 30; k++) points.push({ x: k * 3, y: Math.sin(k) * 18 });
    await created.api.addObject("StrokeObject", {
      position: { x: (i % 22) * 40, y: Math.floor(i / 22) * 40 },
      data: { points },
    });
  }
  await created.api.flush?.();
  await created.close?.();
  return dir;
}

/**
 * 计算目录总字节数
 * @param {string} dir - 目录
 * @returns {number} 字节数
 */
function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

/**
 * 测量全量驻留下的开板成本
 * @param {number} strokeCount - 笔迹数
 * @returns {Promise<Object>} 测量结果
 */
async function measureFull(strokeCount) {
  const dir = await seedBoard(strokeCount);
  const size = dirSize(dir);

  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const reopened = await openBoardSession(dir, { create: false });
  const openMs = performance.now() - t0;
  global.gc?.();
  const after = process.memoryUsage().heapUsed;

  const resident = reopened.boardCore?.objectLoaded?.size ?? -1;
  const result = {
    strokeCount,
    sizeMB: +(size / 1024 / 1024).toFixed(2),
    openMs: +openMs.toFixed(0),
    resident,
    heapMB: +((after - before) / 1024 / 1024).toFixed(1),
  };
  await reopened.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

/**
 * 测量 owner 部分驻留下的开板成本与缓存行为
 * @param {number} strokeCount - 笔迹数
 * @param {number} maxChunks - 驻留区块预算
 * @returns {Promise<Object>} 测量结果
 */
async function measureOwnerCache(strokeCount, maxChunks) {
  const dir = await seedBoard(strokeCount);
  const size = dirSize(dir);

  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const reopened = await openBoardSession(dir, {
    create: false,
    partialResidency: true,
  });
  const openMs = performance.now() - t0;
  global.gc?.();
  const after = process.memoryUsage().heapUsed;

  const boardCore = reopened.boardCore;
  const cache = createOwnerResidencyCache(boardCore, { maxChunks });
  boardCore.setResidencyManager(cache);
  const opened = {
    resident: boardCore.objectLoaded.size,
    fullChunks: cache.stats().fullChunks,
  };

  const known = [...boardCore.getKnownObjectIds()];
  let touched = { resident: opened.resident, fullChunks: opened.fullChunks };
  if (known.length > 1) {
    await cache.ensureObjects([known[0]]);
    await cache.ensureObjects([known[known.length - 1]]);
    touched = {
      resident: boardCore.objectLoaded.size,
      fullChunks: cache.stats().fullChunks,
    };
  }

  const result = {
    strokeCount,
    sizeMB: +(size / 1024 / 1024).toFixed(2),
    openMs: +openMs.toFixed(0),
    openResident: opened.resident,
    openFullChunks: opened.fullChunks,
    touchedResident: touched.resident,
    touchedFullChunks: touched.fullChunks,
    heapMB: +((after - before) / 1024 / 1024).toFixed(1),
  };
  await reopened.flush?.();
  cache.destroy();
  await reopened.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

const args = process.argv.slice(2);
const ownerCache = args.includes("--owner-cache");
const budgetIndex = args.indexOf("--resident-chunks");
const maxChunks =
  budgetIndex === -1 ? 32 : Number(args[budgetIndex + 1]) || 32;

if (ownerCache) {
  console.log(
    `owner 部分驻留（预算 ${maxChunks} 区块）\n笔迹数 | 板目录 | 开板耗时 | 开板驻留/已载 | touch 后驻留/已载 | 开板后堆增量`,
  );
  for (const n of [200, 1000, 3000]) {
    const r = await measureOwnerCache(n, maxChunks);
    console.log(
      `${String(r.strokeCount).padStart(6)} | ${String(r.sizeMB).padStart(6)}MB | ${String(r.openMs).padStart(7)}ms | ${String(r.openResident).padStart(5)}/${String(r.openFullChunks).padStart(3)} | ${String(r.touchedResident).padStart(5)}/${String(r.touchedFullChunks).padStart(3)} | ${String(r.heapMB).padStart(10)}MB`,
    );
  }
} else {
  console.log("笔迹数 | 板目录 | 开板耗时 | 驻留对象 | 开板后堆增量");
  for (const n of [200, 1000, 3000]) {
    const r = await measureFull(n);
    console.log(
      `${String(r.strokeCount).padStart(6)} | ${String(r.sizeMB).padStart(6)}MB | ${String(r.openMs).padStart(7)}ms | ${String(r.resident).padStart(8)} | ${String(r.heapMB).padStart(10)}MB`,
    );
  }
}
process.exit(0);
