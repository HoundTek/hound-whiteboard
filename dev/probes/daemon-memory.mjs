/**
 * @file daemon 常驻持板的内存占用
 * @description 建板写入 N 条笔迹后重新打开会话，测量反序列化后的堆占用与对象驻留数。
 * @author Zhou Chenyu
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoardSession } from "../../src/cli/board-session.js";

/**
 * 测量单个规模下的开板成本
 * @param {number} strokeCount - 笔迹数
 * @returns {Promise<Object>} 测量结果
 */
async function measure(strokeCount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hwb-mem-${strokeCount}-`));
  const created = await openBoardSession(dir, { create: true, width: 900, height: 700 });
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

  const size = (() => {
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
  })();

  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const reopened = await openBoardSession(dir, { create: false });
  const openMs = performance.now() - t0;
  global.gc?.();
  const after = process.memoryUsage().heapUsed;

  const boardCore = reopened.api.getBoardCore?.() ?? reopened.boardCore;
  const resident = boardCore?.objectLoaded?.size ?? -1;
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

console.log("笔迹数 | 板目录 | 开板耗时 | 驻留对象 | 开板后堆增量");
for (const n of [200, 1000, 3000]) {
  const r = await measure(n);
  console.log(
    `${String(r.strokeCount).padStart(6)} | ${String(r.sizeMB).padStart(6)}MB | ${String(r.openMs).padStart(7)}ms | ${String(r.resident).padStart(8)} | ${String(r.heapMB).padStart(10)}MB`,
  );
}
process.exit(0);
