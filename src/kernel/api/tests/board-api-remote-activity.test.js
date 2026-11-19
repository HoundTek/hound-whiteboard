// SPDX-License-Identifier: MIT

import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";

/**
 * AOM 远程活动回归：远程 choose/unchoose 经日志与 ephemeral 双通道收敛到远程活动登记；
 * 远程活跃对象锁定（不可本地选择/擦除/删除）；断线清理解锁。
 */

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
 * 在本端创建并提交一笔静态笔画
 * @param {BoardApi} api - 内核 API
 * @param {string} id - 对象 id
 * @returns {Promise<void>}
 */
async function createStroke(api, id) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 0, y: 0 },
    property: { width: 2 },
    data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
  });
  await api.commitObjects([id]);
}

/**
 * 收集端上日志中的全部记录
 * @param {BoardCore} boardCore - 白板核心
 * @returns {Object[]} 记录数组
 */
function recordsOf(boardCore) {
  return boardCore.operationLog.toJSON();
}

describe("AOM 远程活动", () => {
  test("本地 choose/discard/commit 发射 ephemeral 活动事件", async () => {
    const { boardCore, api } = createEnd("a");
    /** @type {Object[]} */
    const events = [];
    boardCore.activityEventBus.on("activity", (event) => events.push(event));

    await createStroke(api, "a/1");
    await api.addActiveObjects(["a/1"]);
    await api.discardActiveObjects(["a/1"]);

    const kinds = events.map((e) => [e.kind, e.ids]);
    // createStroke 内 commit 一次；choose/discard 各一次
    expect(kinds).toEqual([
      ["commit", ["a/1"]],
      ["choose", ["a/1"]],
      ["unchoose", ["a/1"]],
    ]);
    expect(events[0].source).toBe("a");
  });

  test("ephemeral 远程 choose 登记后本地不可选择、不可擦除、不可删除", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");

    api.applyRemoteActivity({ kind: "choose", ids: ["a/1"] }, "b");
    expect(boardCore.activeObjectManager.isRemoteActive("a/1")).toBe(true);

    // 本地 choose 被拒绝（跳过）
    await api.addActiveObjects(["a/1"]);
    expect(boardCore.activeObjectManager.isActive("a/1")).toBe(false);

    // 本地 erase 跳过远程活跃对象
    const erased = await api.eraseData({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      radius: 5,
    });
    expect(erased.deleted).toEqual([]);
    expect(boardCore.getObjectById("a/1")).not.toBeNull();

    // 本地 delete 跳过远程活跃对象
    await api.deleteObjects(["a/1"]);
    expect(boardCore.getObjectById("a/1")).not.toBeNull();
    expect(boardCore.trash.has("a/1")).toBe(false);
  });

  test("远程 unchoose/commit 解锁，断线清理解锁该来源全部持有", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");

    api.applyRemoteActivity({ kind: "choose", ids: ["a/1", "a/2"] }, "b");
    api.applyRemoteActivity({ kind: "commit", ids: ["a/1"] }, "b");
    expect(boardCore.activeObjectManager.isRemoteActive("a/1")).toBe(false);
    expect(boardCore.activeObjectManager.isRemoteActive("a/2")).toBe(true);

    const removed = api.clearRemoteActivity("b");
    expect(removed).toEqual(["a/2"]);
    expect(boardCore.activeObjectManager.isRemoteActive("a/2")).toBe(false);
  });

  test("日志通道：远程 choose 记录到达后对象登记为远程活动而非本地活动", async () => {
    const a = createEnd("a");
    const b = createEnd("b");

    // a 创建对象并同步到 b
    await createStroke(a.api, "a/1");
    await b.api.applyRemoteOperations(recordsOf(a.boardCore));

    // a 选择对象（choose 记录），同步到 b
    await a.api.addActiveObjects(["a/1"]);
    const chooseRecords = recordsOf(a.boardCore).slice(1);
    await b.api.applyRemoteOperations(chooseRecords);

    expect(
      b.boardCore.activeObjectManager.isRemoteActive("a/1"),
    ).toBe(true);
    expect(b.boardCore.activeObjectManager.isActive("a/1")).toBe(false);

    // b 本地不可擦除该对象
    const erased = await b.api.eraseData({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      radius: 5,
    });
    expect(erased.deleted).toEqual([]);

    // a 放弃选择（unchoose 记录），同步到 b 后解锁
    await a.api.discardActiveObjects(["a/1"]);
    const unchooseRecords = recordsOf(a.boardCore).slice(2);
    await b.api.applyRemoteOperations(unchooseRecords);
    expect(b.boardCore.activeObjectManager.isRemoteActive("a/1")).toBe(false);
  });

  test("并发 choose 冲突：本地活跃优先，远程登记被忽略且两端一致", async () => {
    const a = createEnd("a");
    const b = createEnd("b");

    await createStroke(a.api, "a/1");
    await b.api.applyRemoteOperations(recordsOf(a.boardCore));

    // 两端并发 choose 同一对象
    await a.api.addActiveObjects(["a/1"]);
    await b.api.addActiveObjects(["a/1"]);

    // 互喂 choose 记录：双方都忽略对方的远程登记（本地优先）
    const aChoose = recordsOf(a.boardCore).slice(1);
    const bChoose = recordsOf(b.boardCore).slice(1);
    await a.api.applyRemoteOperations(bChoose);
    await b.api.applyRemoteOperations(aChoose);

    expect(a.boardCore.activeObjectManager.isActive("a/1")).toBe(true);
    expect(b.boardCore.activeObjectManager.isActive("a/1")).toBe(true);
    expect(a.boardCore.activeObjectManager.isRemoteActive("a/1")).toBe(false);
    expect(b.boardCore.activeObjectManager.isRemoteActive("a/1")).toBe(false);
  });
});
