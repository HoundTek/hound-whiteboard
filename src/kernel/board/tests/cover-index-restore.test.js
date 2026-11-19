/**
 * @file 恢复后覆盖索引与区块卸载测试
 * @description 验证会话恢复时按区块静态图重建覆盖索引，区块可完整卸载并从盘上重载。
 * @module kernel/board/tests/cover-index-restore
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { createMemoryDriver } from "../../../io/driver/memory.js";
import { bindRoot } from "../../../io/driver/io-driver.js";
import { createPersistenceAdapter } from "../../../io/adapter/persistence.js";
import { createSessionStore } from "../../store/session-store.js";
import { createJournaler } from "../../store/journaler.js";
import { BoardCore } from "../board-core.js";
import { BoardApi } from "../../api/board-api.js";
import { createDefaultAomRenderHooks } from "../aom-render-hooks.js";

/**
 * 创建并提交一笔横向笔画
 * @param {BoardApi} api - 内核 API
 * @param {string} id - 对象 id
 * @returns {Promise<void>}
 */
async function createStroke(api, id) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 10, y: 10 },
    property: { width: 2 },
    data: { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
  });
  await api.commitObjects([id]);
}

/**
 * 创建一块已落盘的板并读出会话数据
 * @returns {Promise<{session: Object, options: Object}>} 会话数据与重建选项
 */
async function setupPersistedBoard() {
  const driver = createMemoryDriver({ rootId: "mem" });
  const store = createSessionStore(bindRoot(driver, "mem"));
  await store.create();
  const options = {
    width: 1024,
    height: 1024,
    rootPath: "mem",
    persistenceAdapter: createPersistenceAdapter({ driver, rootId: "mem" }),
    aomRenderHooks: createDefaultAomRenderHooks(),
    source: "test",
  };
  const boardCore = new BoardCore(options);
  const api = new BoardApi(boardCore);
  const journaler = createJournaler({ boardCore, store });
  journaler.attach();
  await createStroke(api, "test/obj-1");
  await journaler.flush();
  await journaler.detach();
  return { session: await store.loadAll(), options };
}

describe("恢复后覆盖索引与区块卸载", () => {
  test("恢复后覆盖索引按静态图重建，区块完整卸载后可重载", async () => {
    const { session, options } = await setupPersistedBoard();
    const boardCore = new BoardCore({
      ...options,
      hitRecords: session.records,
    });
    boardCore.restoreSession(session);

    const chunkId = [...boardCore.chunkLoaded.keys()][0];
    const chunk = boardCore.getChunkById(chunkId);
    expect(boardCore.getObjectCoverChunks("test/obj-1")).toEqual(
      new Set([chunkId]),
    );
    expect(chunk.isLoad).toBe(true);

    const loader = await boardCore.loadChunksAndWaitComplete(
      [chunk],
      "cover-restore-test",
    );
    expect(boardCore.getObjectById("test/obj-1")).toBeDefined();
    expect(boardCore.getObjectLoadCount("test/obj-1")).toBe(1);
    boardCore.assertResidencyInvariant();

    loader.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(chunk.isLoad).toBe(false);
    expect(chunk.objectManager).toBeUndefined();
    expect(boardCore.getObjectById("test/obj-1")).toBeUndefined();
    expect(boardCore.isObjectEvicted("test/obj-1")).toBe(true);

    const reloader = await boardCore.loadChunksAndWaitComplete(
      [chunk],
      "cover-restore-test-2",
    );
    expect(boardCore.getObjectById("test/obj-1")).toBeDefined();
    expect(boardCore.getObjectCoverChunks("test/obj-1")).toEqual(
      new Set([chunkId]),
    );
    expect(boardCore.getObjectLoadCount("test/obj-1")).toBe(1);
    boardCore.assertResidencyInvariant();

    reloader.destroy();
    await new Promise((resolve) => setImmediate(resolve));
  });

  test("覆盖索引缺失时按当前区块回退，不抛错", async () => {
    const { session, options } = await setupPersistedBoard();
    const boardCore = new BoardCore({
      ...options,
      hitRecords: session.records,
    });
    boardCore.restoreSession(session);

    const chunkId = [...boardCore.chunkLoaded.keys()][0];
    boardCore.unsetObjectCoverChunks("test/obj-1");
    expect(boardCore.getObjectCoverChunks("test/obj-1")).toBeUndefined();

    expect(() => boardCore.unloadChunkObjectEntries(chunkId)).not.toThrow();
    expect(boardCore.getObjectById("test/obj-1")).toBeUndefined();

    boardCore.unsetObjectCoverChunks("test/obj-1");
    await expect(
      boardCore.syncChunkObjectEntries(chunkId),
    ).resolves.toBeUndefined();
  });
});
