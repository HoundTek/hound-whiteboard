// SPDX-License-Identifier: MIT

/**
 * @file 命名选择（named choice）测试
 * @author Zhou Chenyu
 */

import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";

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

describe("AOM 命名选择", () => {
  test("命名 choose 登记命名选择，queryChoices 与 queryObjects.choice 可见", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");

    await api.addActiveObjects(["a/1", "a/2"], { choice: "hold" });

    expect(api.queryChoices()).toEqual([
      { name: "hold", ids: expect.arrayContaining(["a/1", "a/2"]) },
    ]);
    const summaries = api.queryObjects(["a/1", "a/2"]);
    expect(summaries[0].choice).toBe("hold");
    expect(summaries[1].choice).toBe("hold");
  });

  test("匿名 choose 落匿名桶：查询面不暴露", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");

    await api.addActiveObjects(["a/1"]);

    expect(api.queryChoices()).toEqual([]);
    expect(api.queryObjects(["a/1"])[0].choice).toBeUndefined();
  });

  test("同一对象只属一个本地 choice：显式指派迁移并腾空旧 choice", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");

    await api.addActiveObjects(["a/1", "a/2"], { choice: "first" });
    await api.addActiveObjects(["a/1"], { choice: "second" });

    const choices = api.queryChoices();
    const byName = Object.fromEntries(choices.map((h) => [h.name, h.ids]));
    expect(byName.first).toEqual(["a/2"]);
    expect(byName.second).toEqual(["a/1"]);
    expect(api.queryObjects(["a/1"])[0].choice).toBe("second");
  });

  test("匿名指派不覆盖命名 choice", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");

    await api.addActiveObjects(["a/1"], { choice: "hold" });
    // GUI 手势的匿名再选择（如 modifier 经过）不抢走命名 choice
    await api.addActiveObjects(["a/1"]);

    expect(api.queryObjects(["a/1"])[0].choice).toBe("hold");
  });

  test("commit 后 choice 成员关系自动解除", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");

    await api.addActiveObjects(["a/1"], { choice: "hold" });
    await api.commitObjects(["a/1"]);

    expect(api.queryChoices()).toEqual([]);
    expect(api.queryObjects(["a/1"])[0].choice).toBeUndefined();
  });

  test("discard 后 choice 成员关系自动解除", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");

    await api.addActiveObjects(["a/1"], { choice: "hold" });
    api.discardActiveObjects(["a/1"]);

    expect(api.queryChoices()).toEqual([]);
    expect(api.queryObjects(["a/1"])[0].choice).toBeUndefined();
  });

  test("非法 choice 名报错", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");

    await expect(
      api.addActiveObjects(["a/1"], { choice: "a/b" }),
    ).rejects.toThrow("非法 choice 名");
    await expect(
      api.addActiveObjects(["a/1"], { choice: "~x" }),
    ).rejects.toThrow("非法 choice 名");
    await expect(api.addActiveObjects(["a/1"], { choice: "" })).rejects.toThrow(
      "非法 choice 名",
    );
  });
});

describe("AOM 远程命名选择", () => {
  test("远程 choose 携带 choice 登记命名选择", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");

    api.applyRemoteActivity(
      { kind: "choose", ids: ["a/1"], choice: "hold" },
      "b",
    );

    const aom = boardCore.activeObjectManager;
    expect(aom.isRemoteActive("a/1")).toBe(true);
    expect(aom.remoteChoicesOf("a/1")).toEqual([
      { source: "b", name: "hold" },
    ]);
  });

  test("多来源并发选择同一对象：逐一释放互不误伤", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");

    api.applyRemoteActivity({ kind: "choose", ids: ["a/1"], choice: "x" }, "b");
    api.applyRemoteActivity({ kind: "choose", ids: ["a/1"], choice: "y" }, "c");

    const aom = boardCore.activeObjectManager;
    expect(aom.remoteChoicesOf("a/1")).toHaveLength(2);

    // b 释放后 c 的命名选择仍在（单来源登记表在此场景会提前解锁）
    api.applyRemoteActivity(
      { kind: "unchoose", ids: ["a/1"], choice: "x" },
      "b",
    );
    expect(aom.isRemoteActive("a/1")).toBe(true);
    expect(aom.remoteChoicesOf("a/1")).toEqual([{ source: "c", name: "y" }]);

    api.applyRemoteActivity(
      { kind: "unchoose", ids: ["a/1"], choice: "y" },
      "c",
    );
    expect(aom.isRemoteActive("a/1")).toBe(false);
  });

  test("同一来源重复 choose 同一对象即迁移命名选择", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");

    api.applyRemoteActivity({ kind: "choose", ids: ["a/1"], choice: "x" }, "b");
    api.applyRemoteActivity({ kind: "choose", ids: ["a/1"], choice: "y" }, "b");

    expect(boardCore.activeObjectManager.remoteChoicesOf("a/1")).toEqual([
      { source: "b", name: "y" },
    ]);
  });

  test("远程 unchoose 未携带 choice 时按来源全量注销", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");

    api.applyRemoteActivity({ kind: "choose", ids: ["a/1"], choice: "x" }, "b");
    // 匿名通道（未升级的对端）的 commit 事件不带 choice
    api.applyRemoteActivity({ kind: "commit", ids: ["a/1"] }, "b");

    expect(boardCore.activeObjectManager.isRemoteActive("a/1")).toBe(false);
  });

  test("断线清理按来源清全部命名选择", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");

    api.applyRemoteActivity({ kind: "choose", ids: ["a/1"], choice: "x" }, "b");
    api.applyRemoteActivity({ kind: "choose", ids: ["a/2"] }, "b");

    const removed = api.clearRemoteActivity("b");

    expect(removed).toEqual(expect.arrayContaining(["a/1", "a/2"]));
    expect(boardCore.activeObjectManager.isRemoteActive("a/1")).toBe(false);
    expect(boardCore.activeObjectManager.isRemoteActive("a/2")).toBe(false);
  });
});

describe("日志记录携带 choice", () => {
  /**
   * 收集端上日志中的全部记录
   * @param {BoardCore} boardCore - 白板核心
   * @returns {Object[]} 记录数组
   */
  function recordsOf(boardCore) {
    return boardCore.operationLog.toJSON();
  }

  test("命名 choose/commit/discard 记录携带 choice，匿名不带", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");

    await api.addActiveObjects(["a/1"], { choice: "hold" });
    await api.addActiveObjects(["a/2"]);

    const chooses = recordsOf(boardCore).filter(
      (r) => r.type === "choose-object",
    );
    expect(chooses).toHaveLength(2);
    expect(chooses.find((r) => r.payload.objectId === "a/1").payload.choice).toBe("hold");
    expect(
      chooses.find((r) => r.payload.objectId === "a/2").payload,
    ).not.toHaveProperty("choice");

    await api.commitObjects(["a/1"]);
    api.discardActiveObjects(["a/2"]);

    const unchooses = recordsOf(boardCore).filter(
      (r) => r.type === "unchoose-object",
    );
    expect(unchooses).toHaveLength(2);
    expect(
      unchooses.find((r) => r.payload.objectId === "a/1").payload.choice,
    ).toBe("hold");
    expect(
      unchooses.find((r) => r.payload.objectId === "a/2").payload,
    ).not.toHaveProperty("choice");
  });

  test("日志回放恢复远程命名选择（INIT 全量重建保标签）", async () => {
    const a = createEnd("a");
    const b = createEnd("b");

    await createStroke(a.api, "a/1");
    await b.api.applyRemoteOperations(recordsOf(a.boardCore));

    // a 命名选择并提交，全量日志喂给 b（等价 INIT 重建路径）
    await a.api.addActiveObjects(["a/1"], { choice: "hold" });
    await b.api.applyRemoteOperations(recordsOf(a.boardCore).slice(1));

    expect(b.boardCore.activeObjectManager.remoteChoicesOf("a/1")).toEqual([
      { source: "a", name: "hold" },
    ]);

    // a 提交（unchoose 记录携带 choice），b 精准注销该命名选择
    await a.api.commitObjects(["a/1"]);
    await b.api.applyRemoteOperations(recordsOf(a.boardCore).slice(2));
    expect(b.boardCore.activeObjectManager.isRemoteActive("a/1")).toBe(false);
  });

  test("undo/redo 穿越命名 choose：命名选择随链序解除与恢复", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");

    await api.addActiveObjects(["a/1"], { choice: "hold" });
    expect(api.queryChoices()).toHaveLength(1);

    // 撤销 choose：对象退出活动集，命名选择解除
    api.undo();
    expect(boardCore.activeObjectManager.isActive("a/1")).toBe(false);
    expect(api.queryChoices()).toEqual([]);

    // 重做 choose：对象回到活动集，命名选择按记录恢复
    api.redo();
    expect(boardCore.activeObjectManager.isActive("a/1")).toBe(true);
    expect(api.queryObjects(["a/1"])[0].choice).toBe("hold");
  });
});

describe("活动事件携带 choice", () => {
  /**
   * 收集端上发射的活动事件
   * @param {BoardCore} boardCore - 白板核心
   * @returns {Object[]} 事件数组
   */
  function activitiesOf(boardCore) {
    /** @type {Object[]} */
    const events = [];
    boardCore.activityEventBus.on("activity", (event) => events.push(event));
    return events;
  }

  test("命名 choose 事件携带 choice，匿名与 commit/unchoose 不带", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");
    const events = activitiesOf(boardCore);

    await api.addActiveObjects(["a/1"], { choice: "hold" });
    await api.addActiveObjects(["a/2"]);
    await api.commitObjects(["a/1"]);
    api.discardActiveObjects(["a/2"]);

    const chooses = events.filter((e) => e.kind === "choose");
    expect(chooses).toHaveLength(2);
    expect(chooses[0]).toMatchObject({ ids: ["a/1"], choice: "hold" });
    expect(chooses[1]).toMatchObject({ ids: ["a/2"] });
    expect(chooses[1]).not.toHaveProperty("choice");

    const leavings = events.filter(
      (e) => e.kind === "commit" || e.kind === "unchoose",
    );
    for (const event of leavings) {
      expect(event).not.toHaveProperty("choice");
    }
  });

  test("混合 choose 按命名选择分组发射", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");
    await createStroke(api, "a/3");

    // a/1 先在命名选择中；随后的选择调用把它和匿名对象混在一起
    await api.addActiveObjects(["a/1"], { choice: "hold" });
    const events = activitiesOf(boardCore);
    await api.addActiveObjects(["a/1", "a/2", "a/3"], { choice: "keep" });

    // 三个对象都进入命名选择 keep（显式指派覆盖），合并为一条事件
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "choose",
      ids: expect.arrayContaining(["a/1", "a/2", "a/3"]),
      choice: "keep",
    });
  });

  test("匿名再选择命名选择中的对象：事件携带其当前 choice 名", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");

    await api.addActiveObjects(["a/1"], { choice: "hold" });
    const events = activitiesOf(boardCore);
    // GUI 手势式匿名再选择：所属 choice 不被匿名覆盖，事件如实携带当前 choice 名
    await api.addActiveObjects(["a/1"]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "choose", choice: "hold" });
  });
});

describe("awareness 查询面与变更通知", () => {
  test("queryRemoteChoices 汇总远程注册表", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");
    await createStroke(api, "a/3");

    api.applyRemoteActivity(
      { kind: "choose", ids: ["a/1", "a/2"], choice: "hold" },
      "b",
    );
    api.applyRemoteActivity({ kind: "choose", ids: ["a/3"] }, "c");

    const remote = api.queryRemoteChoices();
    expect(remote).toHaveLength(2);
    const hold = remote.find((r) => r.source === "b");
    expect(hold).toMatchObject({ name: "hold" });
    expect(hold.ids).toEqual(expect.arrayContaining(["a/1", "a/2"]));
    expect(remote.find((r) => r.source === "c")).toMatchObject({
      name: undefined,
      ids: ["a/3"],
    });
  });

  test("remote-activity 事件：ephemeral 与断线清理路径各发一次", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");

    /** @type {Object[]} */
    const notices = [];
    boardCore.activityEventBus.on("remote-activity", (e) => notices.push(e));

    api.applyRemoteActivity(
      { kind: "choose", ids: ["a/1"], choice: "hold" },
      "b",
    );
    expect(notices).toHaveLength(1);

    api.clearRemoteActivity("b");
    expect(notices).toHaveLength(2);
  });

  test("remote-activity 事件：日志回放路径合批为一次", async () => {
    const a = createEnd("a");
    const b = createEnd("b");

    await createStroke(a.api, "a/1");
    await createStroke(a.api, "a/2");
    await b.api.applyRemoteOperations(a.boardCore.operationLog.toJSON());

    /** @type {Object[]} */
    const notices = [];
    b.boardCore.activityEventBus.on("remote-activity", (e) => notices.push(e));

    // 两条 choose 记录（不同 choice）同批到达：回放后合批为一次通知
    await a.api.addActiveObjects(["a/1"], { choice: "x" });
    await a.api.addActiveObjects(["a/2"], { choice: "y" });
    await b.api.applyRemoteOperations(a.boardCore.operationLog.toJSON().slice(2));

    expect(notices).toHaveLength(1);
    expect(b.api.queryRemoteChoices()).toHaveLength(2);
  });
});
