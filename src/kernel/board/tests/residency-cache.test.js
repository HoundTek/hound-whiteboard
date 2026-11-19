/**
 * @file owner 驻留缓存测试
 * @description 验证区块级 LRU 驱逐、驻留统计与 AOM 成员固定。
 * @module kernel/board/tests/residency-cache.test
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
import { createOwnerResidencyCache } from "../residency-cache.js";

/**
 * 装配共享 memory 驱动的持久化板
 * @returns {Object} 驱动、存储、适配器与首个板会话
 */
async function setupBoard() {
  const driver = createMemoryDriver({ rootId: "mem" });
  const store = createSessionStore(bindRoot(driver, "mem"));
  await store.create();
  const adapter = createPersistenceAdapter({ driver, rootId: "mem" });
  const boardCore = new BoardCore({
    width: 100,
    height: 100,
    rootPath: "mem",
    source: "cache-test",
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: adapter,
    chunkUnload: true,
  });
  const api = new BoardApi(boardCore);
  const journaler = createJournaler({ boardCore, store });
  journaler.attach();
  return { store, adapter, boardCore, api, journaler };
}

/**
 * 以部分驻留模式重开板并挂上缓存
 * @param {Object} store - 会话存储
 * @param {Object} adapter - 持久化适配器
 * @param {number} maxChunks - 缓存预算
 * @returns {Promise<Object>} 板核心、API 与缓存
 */
async function reopenWithCache(store, adapter, maxChunks) {
  const session = await store.loadAll({ includeObjects: false });
  const boardCore = new BoardCore({
    width: 100,
    height: 100,
    rootPath: "mem",
    source: "cache-test",
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: adapter,
    chunkUnload: true,
  });
  boardCore.setObjectIndexLoader(() => store.readObjectTypeIndex());
  boardCore.restoreSession(session, { chunksTemp: true });
  const cache = createOwnerResidencyCache(boardCore, { maxChunks });
  boardCore.setResidencyManager(cache);
  return { boardCore, api: new BoardApi(boardCore), cache };
}

/**
 * 示例笔画数据
 * @returns {Object} 笔画数据
 */
const strokeData = () => ({
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
});

describe("OwnerResidencyCache", () => {
  test("按区块 LRU 驱逐，当前操作区块不被驱逐", async () => {
    const first = await setupBoard();
    const idA = await first.api.addObject("StrokeObject", {
      position: { x: 10, y: 10 },
      data: strokeData(),
    });
    const idB = await first.api.addObject("StrokeObject", {
      position: { x: 500, y: 500 },
      data: strokeData(),
    });
    await first.journaler.flush();

    const { boardCore, cache } = await reopenWithCache(
      first.store,
      first.adapter,
      1,
    );
    await cache.ensureObjects([idA]);
    expect(cache.stats().fullChunks).toBe(1);
    expect(boardCore.getObjectById(idA)).toBeDefined();

    await cache.ensureObjects([idB]);
    expect(cache.stats().fullChunks).toBe(1);
    expect(boardCore.getObjectById(idB)).toBeDefined();
    expect(boardCore.getObjectById(idA)).toBeUndefined();

    cache.destroy();
    expect(cache.stats().fullChunks).toBe(0);
  });

  test("AOM 成员所在区块固定不驱逐，预算可临时超出", async () => {
    const first = await setupBoard();
    const idA = await first.api.addObject("StrokeObject", {
      position: { x: 10, y: 10 },
      data: strokeData(),
    });
    const idB = await first.api.addObject("StrokeObject", {
      position: { x: 500, y: 500 },
      data: strokeData(),
    });
    await first.journaler.flush();

    const { boardCore, api, cache } = await reopenWithCache(
      first.store,
      first.adapter,
      1,
    );
    await cache.ensureObjects([idA]);
    await api.addActiveObjects([idA], { choice: "hold" });
    expect(cache.stats().pinnedChunks).toBeGreaterThanOrEqual(1);

    await cache.ensureObjects([idB]);
    expect(boardCore.getObjectById(idA)).toBeDefined();
    expect(boardCore.getObjectById(idB)).toBeDefined();
    expect(cache.stats().fullChunks).toBeGreaterThan(1);

    await api.discardActiveObjects([idA]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await cache.ensureObjects([idB]);
    expect(boardCore.getObjectById(idA)).toBeUndefined();

    cache.destroy();
  });
});
