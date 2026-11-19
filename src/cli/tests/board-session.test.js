/**
 * @file CLI 板会话测试
 * @description 验证 openBoardSession 的持久化装配，覆盖区块卸载后经适配器回读对象的路径。
 * @module cli/tests/board-session.test
 * @author Zhou Chenyu
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openBoardSession } from "../board-session.js";

/**
 * 创建临时板目录并建空板
 * @returns {Promise<{dir: string, cleanup: Function}>} 目录与清理函数
 */
async function tempBoard() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hwb-session-test-"));
  const session = await openBoardSession(dir, {
    create: true,
    width: 800,
    height: 600,
  });
  await session.flush();
  await session.close();
  return {
    dir,
    cleanup: async () => {
      for (let i = 0; i < 10; i += 1) {
        try {
          await fs.rm(dir, { recursive: true, force: true });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    },
  };
}

describe("openBoardSession", () => {
  test("注入持久化适配器：区块卸载后可经对象文件回读", async () => {
    const { dir, cleanup } = await tempBoard();
    const session = await openBoardSession(dir, { source: "session-test" });
    try {
      const id = await session.api.addObject("StrokeObject", {
        data: {
          points: [
            { x: 10, y: 10 },
            { x: 30, y: 20 },
          ],
        },
      });
      await session.flush();

      const boardCore = session.boardCore;
      const chunkId = [...boardCore.chunkLoaded.keys()][0];
      // 模拟区块卸载后的对象离场（CLI 会话 chunkUnload 关闭，手动移除实例）
      boardCore.objectLoaded.delete(id);
      expect(boardCore.getObjectById(id)).toBeUndefined();

      const loaded = await boardCore.loadChunkObjectEntries(chunkId);
      expect([...loaded.keys()]).toEqual([id]);
      expect(boardCore.getObjectById(id)?.data.points).toHaveLength(2);
    } finally {
      await session.close();
      await cleanup();
    }
  }, 15000);

  test("partialResidency 打开不载入对象，按需加载", async () => {
    const { dir, cleanup } = await tempBoard();
    const first = await openBoardSession(dir, { source: "session-test" });
    let id = null;
    try {
      id = await first.api.addObject("StrokeObject", {
        data: {
          points: [
            { x: 10, y: 10 },
            { x: 30, y: 20 },
          ],
        },
      });
      await first.flush();
    } finally {
      await first.close();
    }

    const lazy = await openBoardSession(dir, {
      source: "session-test",
      partialResidency: true,
    });
    try {
      expect(lazy.boardCore.objectLoaded.size).toBe(0);
      expect(lazy.boardCore.getKnownObjectIds().has(id)).toBe(true);
      expect(lazy.boardCore.isFullResidency()).toBe(false);

      await lazy.boardCore.ensureObjectTypeIndex();
      expect(lazy.boardCore.getKnownObjectEntries()).toContainEqual({
        id,
        type: "StrokeObject",
      });

      await lazy.boardCore.ensureObjectsResident([id]);
      expect(lazy.boardCore.getObjectById(id)?.data.points).toHaveLength(2);
    } finally {
      await lazy.close();
      await cleanup();
    }
  }, 15000);
});
