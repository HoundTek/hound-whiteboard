// SPDX-License-Identifier: MIT

/**
 * @file amend 分子生命周期事件测试
 * @description 验证分子写入口发射 amend 事件（begin-mol/amend/end-mol/abort-mol）、
 * amend 历史缓冲与水线查询，回放路径不发射（防回环）。
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

/**
 * 订阅 amend 事件到数组
 * @param {BoardCore} boardCore - 白板核心
 * @returns {Object[]} 消息收集数组
 */
function collectAmends(boardCore) {
  /** @type {Object[]} */
  const messages = [];
  boardCore.activityEventBus.on("amend", (message) => messages.push(message));
  return messages;
}

describe("amend 分子生命周期事件", () => {
  test("修改型分子：begin-mol 携带 before 快照，amend 带 seq，end-mol 收尾", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");
    await api.addActiveObjects(["a/1"]);

    const messages = collectAmends(boardCore);

    const molId = api.beginMol(["a/1"]);
    api.amendMol(molId, { "a/1": { position: { x: 5, y: 5 } } });
    api.amendMol(molId, { "a/1": { position: { x: 7, y: 7 } } });
    api.endMol(molId);

    expect(messages.map((m) => m.kind)).toEqual([
      "begin-mol",
      "amend",
      "amend",
      "end-mol",
    ]);
    expect(messages[0].molId).toBe(molId);
    expect(messages[0].entries).toHaveLength(1);
    expect(messages[0].entries[0].objectId).toBe("a/1");
    expect(messages[0].entries[0].before.position).toEqual({ x: 0, y: 0 });
    expect(messages[0].entries[0].create).toBeUndefined();
    expect(messages[1]).toMatchObject({
      kind: "amend",
      molId,
      seq: 1,
      entries: [{ objectId: "a/1", patch: { position: { x: 5, y: 5 } } }],
    });
    expect(messages[2].seq).toBe(2);
    expect(messages[3]).toEqual({ kind: "end-mol", molId });
  });

  test("创建型分子：begin-mol 携带 create 初始快照（对端画创建中形态）", () => {
    const { boardCore, api } = createEnd("a");
    const objectId = api.createObject("StrokeObject", {
      id: "a/1",
      position: { x: 100, y: 100 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }] },
    });

    const messages = collectAmends(boardCore);
    const molId = api.beginMol([objectId], { create: true });

    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("begin-mol");
    expect(messages[0].entries[0].before).toBeNull();
    expect(messages[0].entries[0].create).toMatchObject({
      type: "StrokeObject",
      position: { x: 100, y: 100 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }] },
    });
    api.abortMol(molId);
  });

  test("创建型重放保留 begin 初始快照，不与后续 append 重复累计", () => {
    const { api } = createEnd("a");
    const objectId = api.createObject("StrokeObject", {
      id: "a/1",
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }] },
    });
    const molId = api.beginMol([objectId], { create: true });
    api.amendMol(molId, {
      [objectId]: { append: { key: "points", items: [{ x: 5, y: 0 }] } },
    });
    api.amendMol(molId, {
      [objectId]: { append: { key: "points", items: [{ x: 10, y: 0 }] } },
    });

    const replay = api.queryMolAmendSince(molId, 0);
    expect(replay.entries[0].create.data.points).toHaveLength(1);
    expect(replay.amends).toHaveLength(2);
    const effectivePoints = [
      ...replay.entries[0].create.data.points,
      ...replay.amends.flatMap((frame) => frame.entries[0].patch.append.items),
    ];
    expect(effectivePoints).toHaveLength(3);
    api.abortMol(molId);
  });

  test("amend 支持 append 补丁（创建手势逐点追点）", () => {
    const { boardCore, api } = createEnd("a");
    const objectId = api.createObject("StrokeObject", {
      id: "a/1",
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }] },
    });
    const molId = api.beginMol([objectId], { create: true });

    const messages = collectAmends(boardCore);
    api.amendMol(molId, {
      [objectId]: { append: { key: "points", items: [{ x: 5, y: 0 }] } },
    });
    api.amendMol(molId, {
      [objectId]: { append: { key: "points", items: [{ x: 8, y: 0 }] } },
    });

    const obj = boardCore.getObjectById(objectId);
    expect(obj.data.points).toHaveLength(3);
    expect(messages.map((m) => m.kind)).toEqual(["amend", "amend"]);
    expect(messages[0].entries[0].patch.append).toEqual({
      key: "points",
      items: [{ x: 5, y: 0 }],
    });
    api.abortMol(molId);
  });

  test("abort-mol 发射中止事件且实例还原到手势起点", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");
    await api.addActiveObjects(["a/1"]);

    const messages = collectAmends(boardCore);
    const molId = api.beginMol(["a/1"]);
    api.amendMol(molId, { "a/1": { position: { x: 9, y: 9 } } });
    api.abortMol(molId);

    expect(messages.map((m) => m.kind)).toEqual([
      "begin-mol",
      "amend",
      "abort-mol",
    ]);
    expect(messages[2]).toEqual({ kind: "abort-mol", molId });
    expect(api.queryObject("a/1").position).toEqual({ x: 0, y: 0 });
  });

  test("amend 历史缓冲：queryMolAmendSince 按 seq 水位取段，分子关闭后不可查", async () => {
    const { api } = createEnd("a");
    await createStroke(api, "a/1");
    await api.addActiveObjects(["a/1"]);

    const molId = api.beginMol(["a/1"]);
    api.amendMol(molId, { "a/1": { position: { x: 1, y: 0 } } });
    api.amendMol(molId, { "a/1": { position: { x: 2, y: 0 } } });
    api.amendMol(molId, { "a/1": { position: { x: 3, y: 0 } } });

    // 水位 1 之后：第 2、3 段
    const since = api.queryMolAmendSince(molId, 1);
    expect(since.molId).toBe(molId);
    expect(since.seq).toBe(3);
    expect(since.entries[0].before.position).toEqual({ x: 0, y: 0 });
    expect(since.amends.map((frame) => frame.seq)).toEqual([2, 3]);

    // 全量（水位 0）
    expect(api.queryMolAmendSince(molId, 0).amends).toHaveLength(3);

    // 关闭后历史随分子清理
    api.endMol(molId);
    expect(api.queryMolAmendSince(molId, 0)).toBeNull();
  });

  test("直接写入口不发射 amend（即时分子无 amend 流）", async () => {
    const { boardCore, api } = createEnd("a");
    await createStroke(api, "a/1");
    await api.addActiveObjects(["a/1"]);

    const messages = collectAmends(boardCore);
    api.modifyObject("a/1", { position: { x: 5, y: 5 } });
    api.modifyObjects([{ objectId: "a/1", patch: { position: { x: 7, y: 7 } } }]);
    api.appendListItem("a/1", "data.points", [{ x: 20, y: 0 }]);
    api.replaceListItem("a/1", "data.points", 0, { x: -1, y: 0 });
    api.createObject("StrokeObject", {
      id: "a/2",
      position: { x: 50, y: 50 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }] },
    });

    expect(messages).toHaveLength(0);
  });

  test("回放路径不发射 amend（防回环）", async () => {
    const a = createEnd("a");
    const b = createEnd("b");

    await createStroke(a.api, "a/1");
    b.api.applyRemoteOperations(a.boardCore.operationLog.toJSON());

    const messages = collectAmends(b.boardCore);

    // a 完成一次增量式分子修改并提交，b 经日志回放应用分子记录
    await a.api.addActiveObjects(["a/1"]);
    const molId = a.api.beginMol(["a/1"]);
    a.api.amendMol(molId, { "a/1": { position: { x: 9, y: 9 } } });
    a.api.endMol(molId);
    await a.api.commitObjects(["a/1"]);
    b.api.applyRemoteOperations(a.boardCore.operationLog.toJSON().slice(1));

    expect(messages).toHaveLength(0);
    expect(b.boardCore.getObjectById("a/1").position.x).toBe(9);
  });
});
