/**
 * @jest-environment node
 */

/**
 * @file addObject 的层位边测试
 * @description 断言经公开接口新增的对象会与它压住的已存在对象建立层位边，绘制顺序按后到者居上。
 * @module kernel/board/add-object-edges-test
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openBoardSession } from "../../../cli/board-session.js";
import { CircleObject } from "../../objects/graph/circle.js";

/**
 * 读出与给定对象相关的层位边
 * @param {Object} boardCore - 白板核心
 * @param {Array<string | number>} objectIds - 对象 id 集合
 * @returns {string[]} 形如 `区块:起点->终点` 的边
 */
function collectLayerEdges(boardCore, objectIds) {
  const chunkIds = new Set();
  for (const objectId of objectIds) {
    for (const chunkId of boardCore.getObjectCoverChunks(objectId) ?? []) {
      chunkIds.add(chunkId);
    }
  }
  const edges = [];
  for (const chunkId of chunkIds) {
    const graph = boardCore.getChunkById(chunkId)?.objectManager?.staticGraph;
    if (!graph) continue;
    for (const node of graph.getNodes()) {
      for (const neighbor of graph.neighborsUnsafe?.(node) ?? []) {
        edges.push(`${chunkId}:${node}->${neighbor}`);
      }
    }
  }
  return edges.sort();
}

describe("新增对象的层位边", () => {
  /**
   * 建一个板会话
   * @returns {Promise<{ session: Object, dir: string }>} 会话与临时目录
   */
  async function createSession() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwb-edges-"));
    const session = await openBoardSession(dir, {
      create: true,
      width: 1024,
      height: 1024,
    });
    return { session, dir };
  }

  /**
   * 新增一个圆
   * @param {Object} session - 板会话
   * @param {{ x: number, y: number }} position - 世界坐标
   * @returns {Promise<string>} 对象 id
   */
  async function addCircle(session, position) {
    return session.api.addObject("CircleObject", {
      position,
      property: {
        strokeColor: "#000000",
        fillColor: "#000000",
        strokeWidth: 2,
      },
      data: { radius: 60 },
    });
  }

  test("相交对象之间会建立层位边，后到者在上", async () => {
    const { session, dir } = await createSession();
    try {
      const first = await addCircle(session, { x: 1000, y: 100 });
      const second = await addCircle(session, { x: 1040, y: 100 });

      const edges = collectLayerEdges(session.boardCore, [first, second]);
      expect(edges.length).toBeGreaterThan(0);
      expect(edges.every((edge) => edge.endsWith(`${first}->${second}`))).toBe(
        true,
      );
    } finally {
      await session.close?.();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("不相交的对象之间不建立层位边", async () => {
    const { session, dir } = await createSession();
    try {
      const first = await addCircle(session, { x: 1000, y: 100 });
      const second = await addCircle(session, { x: 5000, y: 100 });

      expect(collectLayerEdges(session.boardCore, [first, second])).toEqual([]);
    } finally {
      await session.close?.();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("先建的对象在下，绘制顺序等于创建顺序", async () => {
    const { session, dir } = await createSession();
    try {
      const first = await addCircle(session, { x: 1000, y: 100 });
      const second = await addCircle(session, { x: 1040, y: 100 });

      const boardCore = session.boardCore;
      const chunkIds = new Set([
        ...(boardCore.getObjectCoverChunks(first) ?? []),
        ...(boardCore.getObjectCoverChunks(second) ?? []),
      ]);
      const graphs = [...chunkIds]
        .map((chunkId) => boardCore.getChunkById(chunkId)?.objectManager?.staticGraph)
        .filter(Boolean);
      // 拓扑序里 first 必须先出现：它被 second 压住
      for (const graph of graphs) {
        if (!graph.hasNode(first) || !graph.hasNode(second)) continue;
        const order = graph.getTopologicalOrder();
        expect(order.indexOf(first)).toBeLessThan(order.indexOf(second));
      }
      void CircleObject;
    } finally {
      await session.close?.();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
