/**
 * @file 远端回放共驻留测试
 * @description 验证远端 MODIFY 与层位边落在已卸载区块上时，回放前会按记录点名的区块预加载。
 * @module kernel/api/tests/board-api-remote-residency
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { createMemoryDriver } from "../../../io/driver/memory.js";
import { bindRoot } from "../../../io/driver/io-driver.js";
import { createPersistenceAdapter } from "../../../io/adapter/persistence.js";
import { createSessionStore } from "../../store/session-store.js";
import { createJournaler } from "../../store/journaler.js";
import { BoardCore } from "../../board/board-core.js";
import { BoardApi } from "../board-api.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";

/**
 * 创建并提交一笔横向笔画
 * @param {BoardApi} api - BoardApi 实例
 * @param {string} id - 对象 id
 * @param {number} y - 笔画纵坐标
 * @returns {Promise<void>}
 */
async function createStroke(api, id, y) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 0, y },
    property: { width: 2 },
    data: {
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
      ],
    },
  });
  await api.commitObjects([id]);
}

/**
 * 判断两个对象之间是否存在层位边
 * @param {BoardCore} boardCore - BoardCore 实例
 * @param {string} belowId - 在下者 id
 * @param {string} aboveId - 在上者 id
 * @returns {boolean} 边是否存在
 */
function hasLayerEdge(boardCore, belowId, aboveId) {
  for (const { chunk } of boardCore.chunkLoaded.values()) {
    if (chunk?.objectManager?.staticGraph?.hasEdge?.(belowId, aboveId)) {
      return true;
    }
  }
  return false;
}

/**
 * 建立已落盘的 A 端与恢复后的 B 端
 * @returns {Promise<Object>} 测试上下文
 */
async function setupEnds() {
  const driver = createMemoryDriver({ rootId: "mem" });
  const store = createSessionStore(bindRoot(driver, "mem"));
  await store.create();
  const options = {
    width: 1024,
    height: 1024,
    rootPath: "mem",
    persistenceAdapter: createPersistenceAdapter({ driver, rootId: "mem" }),
    aomRenderHooks: createDefaultAomRenderHooks(),
    source: "a",
  };

  const coreA = new BoardCore(options);
  const apiA = new BoardApi(coreA);
  const journaler = createJournaler({ boardCore: coreA, store });
  journaler.attach();
  await createStroke(apiA, "a/x", 100);
  await createStroke(apiA, "a/y", 100);
  await journaler.flush();

  const baseSession = await store.loadAll();
  const coreB = new BoardCore({
    ...options,
    source: "b",
    hitRecords: baseSession.records,
  });
  coreB.restoreSession(baseSession);

  await apiA.addActiveObjects(["a/y"]);
  apiA.modifyObject("a/y", { property: { width: 4 } });
  await apiA.commitObjects(["a/y"]);
  await journaler.flush();
  const baseIds = new Set(baseSession.records.map((record) => record.id));
  const delta = coreA.operationLog
    .toJSON()
    .filter((record) => !baseIds.has(record.id));
  await journaler.detach();

  return { coreA, coreB, apiB: new BoardApi(coreB), delta };
}

describe("远端回放共驻留", () => {
  test("区块完整卸载后，远端 MODIFY 与层位边仍能落到静态图", async () => {
    const { coreB, apiB, delta } = await setupEnds();
    const chunkId = [...coreB.chunkLoaded.entries()].find(
      ([, { chunk }]) => chunk?.objectManager?.staticGraph?.hasNode("a/y"),
    )[0];
    const chunk = coreB.getChunkById(chunkId);

    const loader = await coreB.loadChunksAndWaitComplete(
      [chunk],
      "remote-residency-preload",
    );
    loader.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(chunk.isLoad).toBe(false);
    expect(chunk.objectManager).toBeUndefined();
    expect(coreB.getObjectById("a/y")).toBeUndefined();

    const { applied } = await apiB.applyRemoteOperations(delta);
    expect(applied).toBeGreaterThan(0);
    expect(coreB.getObjectById("a/y")).toBeDefined();
    expect(coreB.getObjectById("a/y").property.width).toBe(4);
    expect(coreB.getChunkById(chunkId).isLoad).toBe(true);
    expect(hasLayerEdge(coreB, "a/x", "a/y")).toBe(true);
    coreB.assertResidencyInvariant();
  });
});
