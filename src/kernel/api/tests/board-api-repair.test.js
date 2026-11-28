// SPDX-License-Identifier: MIT

import { jest } from "@jest/globals";
import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";
import { CHUNK_LOAD_EVENTS } from "../../chunk/chunk-loader.js";

/**
 * 创建一个端（独立的 BoardCore 与 BoardApi）
 * @param {string} source - 端标识
 * @returns {{ boardCore: BoardCore, api: BoardApi }} 端
 */
function createEnd(source) {
  const boardCore = new BoardCore({
    width: 800,
    height: 600,
    source,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
  return { boardCore, api: new BoardApi(boardCore) };
}

/**
 * 创建并提交一个静态笔画
 * @param {BoardApi} api - BoardApi 实例
 * @param {string} id - 对象 id
 * @param {number} y - 纵坐标
 * @returns {Promise<void>}
 */
async function createStaticStroke(api, id, y = 100) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 100, y },
    property: { width: 2 },
    data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
  });
  await api.commitObjects([id]);
}

describe("日志重放自愈（效果层分歧修复）", () => {
  test("位置分歧与整条效果丢失：修复后校验和与派生态一致", async () => {
    const A = createEnd("a");
    const B = createEnd("b");
    await createStaticStroke(A.api, "a/1", 100);
    await createStaticStroke(A.api, "a/2", 300);
    A.api.beginSupra("S");
    await A.api.addActiveObjects(["a/1", "a/2"], { supraKey: "S" });
    const molId = A.api.beginMol(["a/1", "a/2"], { supraKey: "S" });
    A.api.amendMol(molId, {
      "a/1": { position: { x: 200, y: 100 } },
      "a/2": { position: { x: 200, y: 300 } },
    });
    A.api.endMol(molId);
    await A.api.commitObjects(["a/1", "a/2"], { supraKey: "S" });
    A.api.endSupra("S");

    // B 全量应用 = f(日志) 参照；无分歧时两端校验和相等
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());
    const wantHash = B.api.queryStateHash();
    expect(A.api.queryStateHash()).toBe(wantHash);

    // 注入效果层分歧（绕过记录）：a/1 位置没放全、a/2 的 add 效果整条丢失
    A.boardCore.getObjectById("a/1").position.x = 999;
    for (const { chunk } of A.boardCore.chunkLoaded.values()) {
      if (chunk?.objectManager?.staticGraph?.hasNode?.("a/2")) {
        chunk.removeObject("a/2");
      }
    }
    A.boardCore.objectLoaded.delete("a/2");
    A.api.refreshMaterializedProjection({ objectIds: ["a/1", "a/2"] });
    expect(A.api.queryStateHash()).not.toBe(wantHash);

    const toJSON = jest.spyOn(A.boardCore.operationLog, "toJSON");
    const toArray = jest.spyOn(A.boardCore.operationLog, "toArray");
    const toSortedArray = jest.spyOn(A.boardCore.operationLog, "toSortedArray");
    const rebuild = jest.spyOn(A.boardCore.undoTree, "rebuild");
    const result = A.api.repairStateFromLog();
    expect(result.repaired).toBe(true);
    expect(result.fixedIds).toEqual(expect.arrayContaining(["a/1", "a/2"]));
    expect(toJSON).not.toHaveBeenCalled();
    expect(toArray).not.toHaveBeenCalled();
    expect(toSortedArray).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
    expect(A.api.queryObject("a/1").position).toEqual({ x: 200, y: 100 });
    expect(A.api.queryObject("a/2").position).toEqual({ x: 200, y: 300 });
    expect(A.api.queryStateHash()).toBe(wantHash);
  });

  test("trash 分歧：条目丢失经修复对齐", async () => {
    const A = createEnd("a");
    const B = createEnd("b");
    await createStaticStroke(A.api, "a/1");
    await A.api.deleteObjects(["a/1"]);
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());
    const wantHash = B.api.queryStateHash();
    expect(A.api.queryStateHash()).toBe(wantHash);

    // trash 条目丢失（恢复记录的效果没放全）
    A.boardCore.trash.delete("a/1");
    A.api.refreshMaterializedProjection({ objectIds: ["a/1"] });
    expect(A.api.queryStateHash()).not.toBe(wantHash);

    const result = A.api.repairStateFromLog();
    expect(result.repaired).toBe(true);
    expect(A.boardCore.trash.has("a/1")).toBe(true);
    expect(A.api.queryStateHash()).toBe(wantHash);
  });

  test("未闭合分子在途时拒绝修复（活体合法偏离派生态）", async () => {
    const A = createEnd("a");
    await createStaticStroke(A.api, "a/1");
    await A.api.addActiveObjects(["a/1"]);
    const molId = A.api.beginMol(["a/1"]);
    A.api.amendMol(molId, { "a/1": { position: { x: 500, y: 500 } } });

    const before = A.api.queryStateHash();
    const result = A.api.repairStateFromLog();
    expect(result).toEqual({ repaired: false, fixedIds: [] });
    // 状态未被触碰（在途手势的实时改动保留）
    expect(A.api.queryStateHash()).toBe(before);
    expect(A.api.queryObject("a/1").position).toEqual({ x: 500, y: 500 });
    A.api.endMol(molId);
  });

  test("无 open mol 的未提交本地修改与 choice 不被修复回滚", async () => {
    const A = createEnd("a");
    await createStaticStroke(A.api, "a/1");
    await A.api.addActiveObjects(["a/1"], { choice: "hold" });
    A.api.modifyObject("a/1", { position: { x: 99, y: 88 } });
    const before = A.api.queryStateHash();

    expect(A.api.repairStateFromLog()).toEqual({ repaired: false, fixedIds: [] });
    expect(A.api.repairChainFromLog()).toEqual({ repaired: false, fixedIds: [] });
    expect(A.api.queryStateHash()).toBe(before);
    expect(A.api.queryObject("a/1").position).toEqual({ x: 99, y: 88 });
    expect(A.boardCore.activeObjectManager.isActive("a/1")).toBe(true);
    expect(A.api.queryChoices()).toEqual([{ name: "hold", ids: ["a/1"] }]);
  });

  test("嵌套列表修改不改写选择前快照，修复保护后可正确提交", async () => {
    const A = createEnd("a");
    await createStaticStroke(A.api, "a/1");
    await A.api.addActiveObjects(["a/1"], { choice: "hold" });
    A.api.appendListItem("a/1", "points", [{ x: 20, y: 0 }]);

    expect(A.api.repairStateFromLog().repaired).toBe(false);
    expect(A.api.queryObject("a/1").data.points).toHaveLength(3);
    await A.api.commitObjects(["a/1"]);
    const modify = A.boardCore.operationLog.toJSON().find(
      (record) => record.type === "modify-object",
    );
    expect(modify.payload.before.data.points).toHaveLength(2);
    expect(modify.payload.after.data.points).toHaveLength(3);
  });

  test("无修改的命名选择不妨碍其它对象修复且保留持有", async () => {
    const A = createEnd("a");
    await createStaticStroke(A.api, "a/1");
    await createStaticStroke(A.api, "a/2", 300);
    await A.api.addActiveObjects(["a/1"], { choice: "hold" });
    A.boardCore.getObjectById("a/2").position.x = 999;
    A.api.refreshMaterializedProjection({ objectIds: ["a/2"] });

    const result = A.api.repairStateFromLog();
    expect(result.fixedIds).toEqual(["a/2"]);
    expect(A.api.queryObject("a/2").position).toEqual({ x: 100, y: 300 });
    expect(A.api.queryChoices()).toEqual([{ name: "hold", ids: ["a/1"] }]);
  });

  test("部分驻留：修复不把覆盖区块未载的对象补回内存（保住 chunkUnload）", async () => {
    const A = createEnd("a");
    await createStaticStroke(A.api, "a/1");
    expect(A.boardCore.isFullResidency()).toBe(true);

    // 模拟区块卸载：引用计数归零 + 标记卸载后移除对象实例 → 部分驻留
    const chunkId = [...A.boardCore.chunkLoaded.keys()][0];
    A.boardCore.chunkLoaded.get(chunkId).fullLoadedCount = 0;
    A.boardCore.getChunkById(chunkId).isLoad = false;
    A.boardCore.unloadChunkObjectEntries(chunkId);
    expect(A.boardCore.getObjectById("a/1")).toBeUndefined();
    expect(A.boardCore.isFullResidency()).toBe(false);
    expect(A.boardCore.isObjectLegallyUnloaded("a/1")).toBe(true);

    const result = A.api.repairStateFromLog();
    // a/1 的覆盖区块未载：不补回内存，等区块重载时走正常驻留路径
    expect(A.boardCore.getObjectById("a/1")).toBeUndefined();
    expect(result.fixedIds).not.toContain("a/1");
  });
});

describe("局部投影修复的复杂度与延期路径", () => {
  test("百条日志只修一个对象，不读取全日志、不扫描全对象", async () => {
    const A = createEnd("a");
    for (let index = 0; index < 100; index += 1) {
      await createStaticStroke(A.api, `a/${index + 1}`, index * 10);
    }
    expect(A.boardCore.operationLog.size).toBeGreaterThanOrEqual(100);
    A.boardCore.getObjectById("a/50").position.x = 999;
    A.api.refreshMaterializedProjection({ objectIds: ["a/50"] });
    const toJSON = jest.spyOn(A.boardCore.operationLog, "toJSON");
    const toArray = jest.spyOn(A.boardCore.operationLog, "toArray");
    const toSortedArray = jest.spyOn(A.boardCore.operationLog, "toSortedArray");
    const rebuild = jest.spyOn(A.boardCore.undoTree, "rebuild");
    const getAllObjects = jest.spyOn(A.boardCore, "getAllObjects");

    const result = A.api.repairStateFromLog();
    expect(result.fixedIds).toEqual(["a/50"]);
    expect(A.api.queryObject("a/50").position.x).toBe(100);
    expect(A.api.queryObject("a/1").position.x).toBe(100);
    expect(A.api.queryStateHash()).toBe(A.api.queryDerivedStateHash());
    expect(toJSON).not.toHaveBeenCalled();
    expect(toArray).not.toHaveBeenCalled();
    expect(toSortedArray).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
    expect(getAllObjects).not.toHaveBeenCalled();
  });

  test("合法驱逐后的 pending 在区块加载完成时应用", async () => {
    const A = createEnd("a");
    await createStaticStroke(A.api, "a/1");
    const obj = A.boardCore.getObjectById("a/1");
    obj.position.x = 999;
    A.api.refreshMaterializedProjection({ objectIds: ["a/1"] });
    const chunkId = [...A.boardCore.chunkLoaded.keys()][0];
    A.boardCore.chunkLoaded.get(chunkId).fullLoadedCount = 0;
    A.boardCore.getChunkById(chunkId).isLoad = false;
    A.boardCore.unloadChunkObjectEntries(chunkId);

    expect(A.api.repairStateFromLog()).toEqual({ repaired: false, fixedIds: [] });
    const chunk = A.boardCore.getChunkById(chunkId);
    chunk.isLoad = true;
    chunk.isTempLoad = false;
    A.boardCore.chunkLoaded.get(chunkId).fullLoadedCount = 1;
    A.boardCore.registerObjectInstance(obj);
    A.boardCore.chunkLoadEventBus.emit(CHUNK_LOAD_EVENTS.LOAD_COMPLETE, { chunkId });

    expect(A.boardCore.getObjectById("a/1").position.x).toBe(100);
    expect(A.api.queryStateHash()).toBe(A.api.queryDerivedStateHash());
  });
});

describe("活动链校验和（驻留无关）", () => {
  test("链校验和随活动链变化，对象驻留变化不影响", async () => {
    const A = createEnd("a");
    const B = createEnd("b");
    await createStaticStroke(A.api, "a/1");
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());
    expect(A.api.queryChainHash()).toBe(B.api.queryChainHash());

    // 对象实例离场（驻留变化）不影响链校验和
    A.boardCore.objectLoaded.delete("a/1");
    expect(A.api.queryChainHash()).toBe(B.api.queryChainHash());

    // 撤销改变活动链：校验和变化（与内容校验和无关的独立口径）
    A.api.undo();
    expect(A.api.queryChainHash()).not.toBe(B.api.queryChainHash());
  });
});
