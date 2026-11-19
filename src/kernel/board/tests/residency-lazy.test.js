/**
 * @file 部分驻留与懒加载测试
 * @description 验证 TEMP 恢复、按需 FULL 加载、类型索引、驻留判定与 AOM 成员保护。
 * @module kernel/board/tests/residency-lazy.test
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { jest } from "@jest/globals";

import { createMemoryDriver } from "../../../io/driver/memory.js";
import { bindRoot } from "../../../io/driver/io-driver.js";
import { createPersistenceAdapter } from "../../../io/adapter/persistence.js";
import { createSessionStore } from "../../store/session-store.js";
import { createJournaler } from "../../store/journaler.js";
import { BoardCore } from "../board-core.js";
import { BoardApi } from "../../api/board-api.js";
import { prepareRouteResidency } from "../../api/board-api-residency.js";
import { createDefaultAomRenderHooks } from "../aom-render-hooks.js";

/**
 * 创建共享 memory 驱动的持久化板
 * @param {{ width?: number, height?: number }} [options={}] - 区块边长
 * @returns {Object} 板核心、API、存储与日志跟随者
 */
function createBoard({ width = 100, height = 100 } = {}) {
  const driver = createMemoryDriver({ rootId: "mem" });
  const store = createSessionStore(bindRoot(driver, "mem"));
  const adapter = createPersistenceAdapter({ driver, rootId: "mem" });
  const boardCore = new BoardCore({
    width,
    height,
    rootPath: "mem",
    source: "test",
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: adapter,
    chunkUnload: true,
  });
  const api = new BoardApi(boardCore);
  const journaler = createJournaler({ boardCore, store });
  journaler.attach();
  return { boardCore, api, store, journaler, adapter };
}

/**
 * 创建第二个连接到同一 memory 驱动的板核心
 * @param {Object} store - 会话存储
 * @param {Object} adapter - 持久化适配器
 * @returns {BoardCore} 板核心
 */
function reopenBoard(store, adapter) {
  const boardCore = new BoardCore({
    width: 100,
    height: 100,
    rootPath: "mem",
    source: "test",
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: adapter,
    chunkUnload: true,
  });
  boardCore.setObjectIndexLoader(() => store.readObjectTypeIndex());
  return boardCore;
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

/**
 * 等待区块卸载完成
 * @returns {Promise<void>}
 */
const settleUnload = () => new Promise((resolve) => setTimeout(resolve, 400));

describe("部分驻留与懒加载", () => {
  test(
    "TEMP 恢复不载入对象，FULL 加载经适配器回读",
    async () => {
      const first = createBoard();
      await first.store.create();
      const id = await first.api.addObject("StrokeObject", {
        position: { x: 10, y: 10 },
        data: strokeData(),
      });
      await first.journaler.flush();

      const lazySession = await first.store.loadAll({ includeObjects: false });
      expect(lazySession.objects).toEqual([]);

      const second = reopenBoard(first.store, first.adapter);
      second.restoreSession(lazySession, { chunksTemp: true });
      expect(second.objectLoaded.size).toBe(0);
      expect(second.isFullResidency()).toBe(false);
      expect(() => second.assertResidencyInvariant()).not.toThrow();

      await second.ensureObjectTypeIndex();
      expect(second.getObjectType(id)).toBe("StrokeObject");
      expect(second.getKnownObjectEntries()).toEqual([
        { id, type: "StrokeObject" },
      ]);

      const release = await second.ensureObjectsResident([id]);
      expect(second.getObjectById(id)?.data.points).toHaveLength(2);
      expect(second.isFullResidency()).toBe(true);
      expect(() => second.assertResidencyInvariant()).not.toThrow();

      release?.();
      await settleUnload();
      expect(second.getObjectById(id)).toBeUndefined();
      expect(second.isFullResidency()).toBe(false);
    },
    15000,
  );

  test("区块元数据带类型时首次清单不扫描 objects/", async () => {
    const first = createBoard();
    await first.store.create();
    const id = await first.api.addObject("StrokeObject", {
      position: { x: 10, y: 10 },
      data: strokeData(),
    });
    await first.journaler.flush();

    const lazySession = await first.store.loadAll({ includeObjects: false });
    expect(lazySession.chunkMetadataList[0].objectTypes).toEqual([
      [id, "StrokeObject"],
    ]);

    const second = reopenBoard(first.store, first.adapter);
    const loader = jest.fn(() => {
      throw new Error("不应扫描 objects/");
    });
    second.setObjectIndexLoader(loader);
    second.restoreSession(lazySession, { chunksTemp: true });

    await second.ensureObjectTypeIndex();
    expect(loader).not.toHaveBeenCalled();
    expect(second.getObjectType(id)).toBe("StrokeObject");
    expect(second.getKnownObjectEntries()).toEqual([
      { id, type: "StrokeObject" },
    ]);
  });

  test("旧板区块元数据缺类型时回退扫描一次", async () => {
    const first = createBoard();
    await first.store.create();
    const id = await first.api.addObject("StrokeObject", {
      position: { x: 10, y: 10 },
      data: strokeData(),
    });
    await first.journaler.flush();

    const lazySession = await first.store.loadAll({ includeObjects: false });
    const legacySession = {
      ...lazySession,
      chunkMetadataList: lazySession.chunkMetadataList.map((metadata) => ({
        ...metadata,
        objectTypes: [],
      })),
    };

    const second = reopenBoard(first.store, first.adapter);
    const loader = jest.fn(() => first.store.readObjectTypeIndex());
    second.setObjectIndexLoader(loader);
    second.restoreSession(legacySession, { chunksTemp: true });

    await second.ensureObjectTypeIndex();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(second.getObjectType(id)).toBe("StrokeObject");
  });

  test("abortSupra 在成员区块被卸载后先恢复驻留再逆放", async () => {
    const board = createBoard();
    await board.store.create();
    const { boardCore, api } = board;
    const id = await api.addObject("StrokeObject", {
      position: { x: 10, y: 10 },
      data: strokeData(),
    });

    api.beginSupra("gesture");
    await api.addActiveObjects([id], { supraKey: "gesture" });
    await board.journaler.flush();

    const chunkId = [...boardCore.getObjectCoverChunks(id)][0];
    const chunk = boardCore.getChunkById(chunkId);
    const chunkState = boardCore.chunkLoaded.get(chunkId);
    chunkState.fullLoadedCount = 0;
    chunkState.tempLoadedCount = 0;
    chunk.unload();
    expect(chunk.isLoad).toBe(false);

    const release = await prepareRouteResidency(boardCore, "abortSupra", {
      key: "gesture",
    });
    expect(chunk.isLoad).toBe(true);
    expect(chunk.isTempLoad).toBe(false);
    release?.();

    api.abortSupra("gesture");
    expect(boardCore.activeObjectManager.isActive(id)).toBe(false);
    expect(boardCore.getObjectById(id)).toBeDefined();
  });

  test("AOM 成员所在区块不被驱逐，pin 覆盖其覆盖区块", async () => {
    const board = createBoard();
    await board.store.create();
    const { boardCore, api } = board;
    const id = await api.addObject("StrokeObject", {
      position: { x: 10, y: 10 },
      data: strokeData(),
    });
    await api.addActiveObjects([id], { choice: "hold" });

    const chunkId = [...boardCore.getObjectCoverChunks(id)][0];
    expect(boardCore.activeObjectManager.queryMemberIds()).toContain(id);
    expect(boardCore.getPinnedChunkIds().has(chunkId)).toBe(true);

    boardCore.chunkLoaded.get(chunkId).fullLoadedCount = 0;
    boardCore.unloadChunkObjectEntries(chunkId);
    expect(boardCore.getObjectById(id)).toBeDefined();

    await api.discardActiveObjects([id]);
    expect(boardCore.activeObjectManager.queryMemberIds()).not.toContain(id);
    boardCore.chunkLoaded.get(chunkId).fullLoadedCount = 0;
    boardCore.unloadChunkObjectEntries(chunkId);
    expect(boardCore.getObjectById(id)).toBeUndefined();
  });

  test("懒加载打开时 isFullResidency 为 false，全量打开为 true", async () => {
    const first = createBoard();
    await first.store.create();
    await first.api.addObject("StrokeObject", {
      position: { x: 10, y: 10 },
      data: strokeData(),
    });
    await first.journaler.flush();

    expect(first.boardCore.isFullResidency()).toBe(true);

    const fullSession = await first.store.loadAll();
    const full = reopenBoard(first.store, first.adapter);
    full.restoreSession(fullSession);
    expect(full.objectLoaded.size).toBe(1);
    expect(full.isFullResidency()).toBe(true);

    const lazySession = await first.store.loadAll({ includeObjects: false });
    const lazy = reopenBoard(first.store, first.adapter);
    lazy.restoreSession(lazySession, { chunksTemp: true });
    expect(lazy.isFullResidency()).toBe(false);
  });
});
