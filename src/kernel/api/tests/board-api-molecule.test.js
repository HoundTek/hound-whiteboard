// SPDX-License-Identifier: MIT

import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";
import { Vector } from "../../utils/math.js";

/**
 * 构造一个测试端（BoardCore + BoardApi）
 * @param {string} [source] - 来源标识（缺省 "core"）
 * @param {number[]} [times] - 依次注入的物理时间（缺省真实时间）
 * @returns {{ boardCore: BoardCore, api: BoardApi }} 测试端
 */
function createEnd(source, times) {
  let tick = 0;
  const boardCore = new BoardCore({
    width: 800,
    height: 600,
    source,
    now: times ? () => times[Math.min(tick++, times.length - 1)] : undefined,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
  return { boardCore, api: new BoardApi(boardCore) };
}

function horizontalPoints() {
  return [
    { x: 0, y: 100 },
    { x: 10, y: 100 },
    { x: 20, y: 100 },
    { x: 30, y: 100 },
    { x: 40, y: 100 },
  ];
}

async function createStaticStroke(api, id, points = horizontalPoints()) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 0, y: 0 },
    property: { width: 2 },
    data: { points },
  });
  await api.commitObjects([id]);
}

/**
 * 一次拖动手势（beginMol → amend → endMol）
 * @param {BoardApi} api -  BoardApi 实例
 * @param {string} id - 对象 id
 * @param {{ x: number, y: number }} to - 终点位置
 * @param {string} [supraKey] - 归属超分子 key
 * @returns {string} 分子 id
 */
function dragOnce(api, id, to, supraKey) {
  const molId = api.beginMol([id], { supraKey });
  api.amendMol(molId, { [id]: { position: to } });
  api.endMol(molId);
  return molId;
}

/**
 * 日志记录的类型序列
 * @param {BoardCore} boardCore - 白板核心
 * @returns {string[]} 类型序列
 */
const recordTypes = (boardCore) => boardCore.operationLog.toArray().map((r) => r.type);

describe("增量式分子生命周期", () => {
  test("beginMol → amend → endMol：物化为分子记录上链，amend 不产生记录", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    await api.addActiveObjects(["s1"]);
    const logSizeBefore = boardCore.operationLog.size;

    const molId = api.beginMol(["s1"]);
    api.amendMol(molId, { s1: { position: { x: 10, y: 0 } } });
    api.amendMol(molId, { s1: { position: { x: 20, y: 0 } } });
    api.amendMol(molId, { s1: { position: { x: 30, y: 0 } } });
    // 原子（帧增量）永不落盘：amend 期间日志零增长，实例即时跟随
    expect(boardCore.operationLog.size).toBe(logSizeBefore);
    expect(api.queryObject("s1").position).toEqual({ x: 30, y: 0 });

    api.endMol(molId);
    const records = boardCore.operationLog.toArray();
    const molRecords = boardCore.operationLog.getMoleculeMembers(molId);
    expect(molRecords).toHaveLength(1);
    expect(molRecords[0].type).toBe("modify-object");
    expect(molRecords[0].molId).toBe(molId);
    // before = 手势起点快照，after = 终点折叠
    expect(molRecords[0].payload.before.position).toEqual({ x: 0, y: 0 });
    expect(molRecords[0].payload.after.position).toEqual({ x: 30, y: 0 });
    expect(records.at(-1).id).toBe(molRecords[0].id);
  });

  test("多对象手势归并为一个分子节点（一次撤销撤整个手势）", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    await createStaticStroke(api, "s2", [{ x: 300, y: 300 }, { x: 320, y: 300 }]);
    await api.addActiveObjects(["s1", "s2"]);

    const molId = api.beginMol(["s1", "s2"]);
    api.amendMol(molId, {
      s1: { position: { x: 50, y: 50 } },
      s2: { position: { x: 350, y: 350 } },
    });
    api.endMol(molId);

    expect(boardCore.operationLog.getMoleculeMembers(molId)).toHaveLength(2);
    const head = boardCore.undoTree.head;
    expect(head.molId).toBe(molId);
    expect(head.memberIds).toHaveLength(2);

    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    expect(api.queryObject("s2").position).toEqual({ x: 0, y: 0 });
  });

  test("abortMol：实例还原到手势起点，不产生记录", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    await api.addActiveObjects(["s1"]);
    const logSizeBefore = boardCore.operationLog.size;

    const molId = api.beginMol(["s1"]);
    api.amendMol(molId, { s1: { position: { x: 50, y: 50 } } });
    expect(api.abortMol(molId)).toBe(true);

    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    expect(boardCore.operationLog.size).toBe(logSizeBefore);
    expect(boardCore.activeObjectManager.isActive("s1")).toBe(true);
  });

  test("已关闭分子的 amend/end 幂等空操作（RPC 竞态防护）", async () => {
    const { api } = createEnd();
    await createStaticStroke(api, "s1");
    await api.addActiveObjects(["s1"]);
    const molId = api.beginMol(["s1"]);
    api.endMol(molId);
    expect(api.amendMol(molId, { s1: { position: { x: 99, y: 99 } } })).toBe(false);
    expect(api.endMol(molId)).toBe(false);
    expect(api.abortMol(molId)).toBe(false);
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
  });

  test("beginMol 准入：非活动对象与未开启的超分子均抛错", async () => {
    const { api } = createEnd();
    await createStaticStroke(api, "s1");
    expect(() => api.beginMol(["s1"])).toThrow("不是活动对象");
    await api.addActiveObjects(["s1"]);
    expect(() => api.beginMol(["s1"], { supraKey: "nope" })).toThrow("未开启");
  });

  test("endMol 后 commitObjects 不重复产生修改分子（已物化水位）", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    await api.addActiveObjects(["s1"]);
    dragOnce(api, "s1", { x: 50, y: 50 });
    await api.commitObjects(["s1"]);
    expect(recordTypes(boardCore)).toEqual([
      "add-object",
      "choose-object",
      "modify-object",
      "unchoose-object",
    ]);
  });

  test("queryOpenMols 列出未闭合分子清单", async () => {
    const { api } = createEnd();
    await createStaticStroke(api, "s1");
    await api.addActiveObjects(["s1"]);
    const molId = api.beginMol(["s1"]);
    api.amendMol(molId, { s1: { position: { x: 5, y: 0 } } });
    const open = api.queryOpenMols();
    expect(open).toHaveLength(1);
    expect(open[0].molId).toBe(molId);
    expect(open[0].seq).toBe(1);
    expect(open[0].entries[0].objectId).toBe("s1");
    expect(open[0].entries[0].before.position).toEqual({ x: 0, y: 0 });
    api.endMol(molId);
    expect(api.queryOpenMols()).toHaveLength(0);
  });
});

describe("撤销语义三分（场景推演）", () => {
  test("场景 1：拖动中 Ctrl+Z 先闭合当前分子再撤销，位置回退选择保留", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S");

    // 第二次拖动进行中（不松手）
    const mol2 = api.beginMol(["s1"], { supraKey: "S" });
    api.amendMol(mol2, { s1: { position: { x: 80, y: 0 } } });
    const result = api.undo();

    // 先物化 mol2 再撤销：所有操作都有记录
    expect(result.forcedEndMolIds).toEqual([mol2]);
    expect(result.undone).toBe(true);
    const mol2Records = boardCore.operationLog.getMoleculeMembers(mol2);
    expect(mol2Records).toHaveLength(1);
    // 位置回第一次拖动后，选择保留
    expect(api.queryObject("s1").position).toEqual({ x: 30, y: 0 });
    expect(boardCore.activeObjectManager.isActive("s1")).toBe(true);
  });

  test("场景 2：未闭合超分子内逐分子撤销，撤到 choose 后会话可纯清理", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S");
    dragOnce(api, "s1", { x: 80, y: 0 }, "S");

    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 30, y: 0 });
    expect(boardCore.activeObjectManager.isActive("s1")).toBe(true);
    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    expect(boardCore.activeObjectManager.isActive("s1")).toBe(true);
    api.undo();
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);

    // 撤到 choose 后会话终止：成员全在已撤销分支，abortSupra 退化为纯句柄清理
    const logSizeBefore = boardCore.operationLog.size;
    api.abortSupra("S");
    expect(boardCore.operationLog.size).toBe(logSizeBefore);
    expect(api.hasSupra?.("S") ?? boardCore.hitCommitter.hasSupra("S")).toBe(false);
  });

  test("场景 3：Enter 闭合后 Ctrl+Z 撤整个聚合节点，redo 正放", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S");
    dragOnce(api, "s1", { x: 80, y: 0 }, "S");
    await api.commitObjects(["s1"], { supraKey: "S" });
    api.endSupra("S");

    // 闭合折叠：add、聚合节点{choose, mov1, mov2, unchoose}
    const chain = boardCore.undoTree.getActiveChain();
    expect(chain).toHaveLength(2);
    expect(chain[1].memberIds).toHaveLength(4);
    expect(api.queryObject("s1").position).toEqual({ x: 80, y: 0 });
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);

    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);

    expect(api.redo().redone).toBe(true);
    expect(api.queryObject("s1").position).toEqual({ x: 80, y: 0 });
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);
  });

  test("场景 4：Esc 闭合（discard 型 unchoose）零撤销动作，事后撤销与 Enter 殊途同归", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S");
    dragOnce(api, "s1", { x: 80, y: 0 }, "S");
    api.discardActiveObjects(["s1"], { supraKey: "S" });
    api.endSupra("S");

    // Esc 闭合：位置回选择前快照、选择取消，无撤销动作
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);
    const records = boardCore.operationLog.toArray();
    const unchoose = records.find((r) => r.type === "unchoose-object");
    expect(unchoose.discard).toBe(true);
    expect(recordTypes(boardCore)).not.toContain("undo");

    // tree 视图：聚合节点成员展开，discard 型取消选择带 (discard) 后缀
    const treeView = api.queryUndoTree();
    const supraNode = treeView.nodes.find((n) => n.memberTypes != null);
    expect(supraNode.supraId).not.toBeNull();
    expect(supraNode.memberTypes).toEqual([
      "choose-object",
      "modify-object",
      "modify-object",
      "unchoose-object(discard)",
    ]);

    // 事后 Ctrl+Z 撤整个聚合节点：与 Enter 闭合的撤销殊途同归
    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);
    expect(api.redo().redone).toBe(true);
    // redo 正放：choose → mov1 → mov2 → unchoose(discard) → 位置回选择前
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
  });

  test("撤销 choose 后重新选择：残留快照不产 discard 泄漏，重新选择重新上链", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    api.beginSupra("S1");
    await api.addActiveObjects(["s1"], { supraKey: "S1" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S1");
    // 撤 modify、撤 choose：对象退出活动层，选择前快照仍残留（redo 路径依赖）
    api.undo();
    api.undo();
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });

    // 新会话先丢弃残留选择（chooser 换选语义）：已退出活动层，幂等空操作不产记录
    api.beginSupra("S2");
    api.discardActiveObjects(["s1"], { supraKey: "S2" });
    expect(
      boardCore.operationLog
        .toArray()
        .filter((r) => r.type === "unchoose-object"),
    ).toHaveLength(0);

    // 重新选择产生新的 choose 分子并挂入新超分子（残留快照不得拦截）
    await api.addActiveObjects(["s1"], { supraKey: "S2" });
    dragOnce(api, "s1", { x: 50, y: 0 }, "S2");
    dragOnce(api, "s1", { x: 80, y: 0 }, "S2");
    await api.commitObjects(["s1"], { supraKey: "S2" });
    api.endSupra("S2");

    // 折叠段恰好 {choose, mov1, mov2, unchoose}，无 discard 泄漏进段首
    const aggregate = boardCore.undoTree.getActiveChain().at(-1);
    expect(
      aggregate.memberIds.map((id) => boardCore.operationLog.get(id).type),
    ).toEqual([
      "choose-object",
      "modify-object",
      "modify-object",
      "unchoose-object",
    ]);
    expect(api.queryObject("s1").position).toEqual({ x: 80, y: 0 });

    // 撤整个聚合回选择前，redo 回定格
    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);
    expect(api.redo().redone).toBe(true);
    expect(api.queryObject("s1").position).toEqual({ x: 80, y: 0 });
  });

  test("撤销提交型 unchoose 后再操作：回放再激活补捕快照，再提交不抛错", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    await api.addActiveObjects(["s1"]);
    // 无差异提交：只产取消选择分子，选择前快照随之删除
    await api.commitObjects(["s1"]);
    api.undo();
    // 撤 unchoose：对象经回放再激活（快照需补捕，否则后续提交抛「缺选择前快照」）
    expect(boardCore.activeObjectManager.has("s1")).toBe(true);

    const molId = dragOnce(api, "s1", { x: 60, y: 0 });
    await expect(api.commitObjects(["s1"])).resolves.toEqual(["s1"]);
    expect(api.queryObject("s1").position).toEqual({ x: 60, y: 0 });
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);

    // 手势已物化修改分子（before 为再激活时刻状态），提交只补取消选择分子
    expect(boardCore.operationLog.getMoleculeMembers(molId)).toHaveLength(1);
    expect(recordTypes(boardCore).at(-1)).toBe("unchoose-object");
  });

  test("场景 6/7：未闭合撤销分子后再拖并闭合，折叠只取活动链成员", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S");
    const mol2 = dragOnce(api, "s1", { x: 80, y: 0 }, "S");
    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 30, y: 0 });

    // 撤销后再拖动：mov3 的 before 取当前活动层位置（mov1 后）
    dragOnce(api, "s1", { x: 60, y: 0 }, "S");
    await api.commitObjects(["s1"], { supraKey: "S" });
    api.endSupra("S");

    const head = boardCore.undoTree.head;
    const members = head.memberIds.map((id) => boardCore.operationLog.get(id));
    expect(members.map((r) => r.type)).toEqual([
      "choose-object",
      "modify-object",
      "modify-object",
      "unchoose-object",
    ]);
    // mov2 在已撤销分支，不参与折叠
    const mov2Records = boardCore.operationLog.getMoleculeMembers(mol2);
    expect(head.memberIds).not.toContain(mov2Records[0].id);
    // mov3 的 before = mov1 后的位置
    expect(members[2].payload.before.position).toEqual({ x: 30, y: 0 });

    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    api.redo();
    expect(api.queryObject("s1").position).toEqual({ x: 60, y: 0 });
  });

  test("场景 9：成员被并发异节点分隔时分段折叠（退化规则）", async () => {
    const alice = createEnd("alice", [100, 110, 120, 130, 140, 150]);
    const bob = createEnd("bob", [125]);
    await createStaticStroke(alice.api, "s1");
    alice.api.beginSupra("S");
    await alice.api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(alice.api, "s1", { x: 30, y: 0 }, "S");

    // 对端并发操作插入在超分子成员之间（时间标记 125 介于 mov1 与 mov2 之间）
    await createStaticStroke(bob.api, "b1", [{ x: 500, y: 500 }, { x: 510, y: 500 }]);
    await alice.api.applyRemoteOperations(bob.boardCore.operationLog.toArray());

    dragOnce(alice.api, "s1", { x: 80, y: 0 }, "S");
    await alice.api.commitObjects(["s1"], { supraKey: "S" });
    alice.api.endSupra("S");

    // 分段折叠：{choose, mov1} 与 {mov2, unchoose} 两个聚合节点，bob 的节点介于其间
    const chain = alice.boardCore.undoTree.getActiveChain();
    expect(chain).toHaveLength(4);
    expect(chain[1].memberIds).toHaveLength(2);
    expect(chain[2].shareId).toBe("bob/op-1");
    expect(chain[3].memberIds).toHaveLength(2);

    // 各撤各的：本端最近节点 = 末端聚合节点 {mov2, unchoose}
    alice.api.undo();
    expect(alice.api.queryObject("s1").position).toEqual({ x: 30, y: 0 });
    expect(alice.boardCore.activeObjectManager.isActive("s1")).toBe(true);
    // 对端操作不受影响
    expect(alice.boardCore.getObjectById("b1")).toBeDefined();
  });

  test("场景 11：abortSupra 丢弃未闭合分子并逐个撤销已物化成员", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S");
    // 在途分子（未物化）
    const molOpen = api.beginMol(["s1"], { supraKey: "S" });
    api.amendMol(molOpen, { s1: { position: { x: 99, y: 99 } } });

    api.abortSupra("S");

    // 在途分子的 amend 丢弃、实例还原；已物化成员（choose、mov1）逐个撤销
    expect(api.queryObject("s1").position).toEqual({ x: 0, y: 0 });
    expect(boardCore.activeObjectManager.has("s1")).toBe(false);
    expect(boardCore.operationLog.getMoleculeMembers(molOpen)).toHaveLength(0);
    const undoRecords = boardCore.operationLog.toArray().filter((r) => r.type === "undo");
    expect(undoRecords).toHaveLength(2);
    expect(boardCore.undoTree.getActiveChain()).toHaveLength(1);
  });

  test("场景 14：增量式与即时分子混合在同一超分子内折叠", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    await createStaticStroke(api, "s2", [{ x: 300, y: 300 }, { x: 320, y: 300 }]);
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S");
    // 即时分子（无 molId）：擦除式修改直接物化挂入同一超分子
    await api.eraseData({
      points: [new Vector(305, 295), new Vector(305, 305)],
      radius: 1,
      source: "core",
    }, { supraKey: "S" });
    dragOnce(api, "s1", { x: 80, y: 0 }, "S");
    await api.commitObjects(["s1"], { supraKey: "S" });
    api.endSupra("S");

    const head = boardCore.undoTree.head;
    const members = head.memberIds.map((id) => boardCore.operationLog.get(id));
    // 折叠只认 supraId：增量式（带 molId）与即时式（无 molId）混合成员全部在内
    expect(members.length).toBeGreaterThanOrEqual(5);
    expect(members[0].type).toBe("choose-object");
    expect(members.at(-1).type).toBe("unchoose-object");
    const molIds = members.map((r) => r.molId);
    expect(molIds[1]).not.toBeNull();
    expect(molIds[2]).toBeNull();
    expect(members.every((r) => r.supraId === members[0].supraId)).toBe(true);
  });
});

describe("恢复重建与旧日志兼容", () => {
  test("重放日志重建后折叠形态与撤销语义一致", async () => {
    const { boardCore, api } = createEnd("alice");
    await createStaticStroke(api, "s1");
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    dragOnce(api, "s1", { x: 30, y: 0 }, "S");
    dragOnce(api, "s1", { x: 80, y: 0 }, "S");
    await api.commitObjects(["s1"], { supraKey: "S" });
    api.endSupra("S");
    const records = boardCore.operationLog.toJSON();

    // 模拟恢复：从日志重放重建树
    const rebuilt = new BoardCore({
      width: 800,
      height: 600,
      source: "alice",
      hitRecords: records,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const chain = rebuilt.undoTree.getActiveChain();
    expect(chain).toHaveLength(2);
    expect(chain[1].memberIds).toHaveLength(4);
    // 会话超分子 id（supra-1 为创建时的内部匿名超分子）
    expect(chain[1].supraId).toBe("alice/supra-2");
    // 续号不撞号（两个拖动分子 + 两个超分子已占号）
    expect(rebuilt.hitCommitter.allocateMolId()).toBe("alice/mol-3");
    rebuilt.hitCommitter.beginSupra("S2");
    expect(rebuilt.hitCommitter.getSupraId("S2")).toBe("alice/supra-3");
  });

  test("旧日志（无 molId/supraId/discard 字段）读取为即时分子形态", async () => {
    const legacyRecords = [
      {
        id: "alice/op-1",
        type: "add-object",
        source: "alice",
        time: 100,
        parentId: null,
        supraOpId: null,
        properties: [],
        payload: {
          chunkId: "1",
          objectId: "o1",
          data: { type: "StrokeObject", id: "o1", position: { x: 0, y: 0 }, transform: { a: 1, b: 0, c: 0, d: 1 }, property: {}, data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } },
          layerStackSnapshot: ["o1"],
        },
      },
      {
        id: "alice/op-2",
        type: "choose-object",
        source: "alice",
        time: 110,
        parentId: "alice/op-1",
        supraOpId: "alice/op-2",
        properties: [],
        payload: { chunkId: "1", objectId: "o1" },
      },
      {
        id: "alice/op-3",
        type: "unchoose-object",
        source: "alice",
        time: 120,
        parentId: "alice/op-2",
        supraOpId: "alice/op-2",
        properties: [],
        payload: { chunkId: "1", objectId: "o1" },
      },
    ];
    const rebuilt = new BoardCore({
      width: 800,
      height: 600,
      source: "alice",
      hitRecords: legacyRecords,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    // 旧形态超分子（supraOpId 首分子自指）重建为单节点，成员序列可展开
    const chain = rebuilt.undoTree.getActiveChain();
    expect(chain).toHaveLength(2);
    expect(chain[1].memberIds).toEqual(["alice/op-2", "alice/op-3"]);
    // 读入归一化：新字段补默认值
    const record = rebuilt.operationLog.get("alice/op-2");
    expect(record.molId).toBeNull();
    expect(record.supraId).toBeNull();
    expect(record.discard).toBe(false);
  });
});

describe("分子归并与物化边界", () => {
  test("同分子多对象记录相邻归并，手势间各自独立", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    await api.addActiveObjects(["s1"]);
    dragOnce(api, "s1", { x: 30, y: 0 });
    dragOnce(api, "s1", { x: 80, y: 0 });
    // 两次手势 = 两个独立分子节点（未闭合超分子内撤销粒度是分子）
    const chain = boardCore.undoTree.getActiveChain();
    expect(chain).toHaveLength(4);
    api.undo();
    expect(api.queryObject("s1").position).toEqual({ x: 30, y: 0 });
  });

  test("endSupra 自动闭合其下未闭合的分子", async () => {
    const { boardCore, api } = createEnd();
    await createStaticStroke(api, "s1");
    api.beginSupra("S");
    await api.addActiveObjects(["s1"], { supraKey: "S" });
    const molId = api.beginMol(["s1"], { supraKey: "S" });
    api.amendMol(molId, { s1: { position: { x: 42, y: 0 } } });
    api.endSupra("S");

    expect(api.queryOpenMols()).toHaveLength(0);
    expect(boardCore.operationLog.getMoleculeMembers(molId)).toHaveLength(1);
    // choose + modify 折叠为聚合节点
    const chain = boardCore.undoTree.getActiveChain();
    expect(chain).toHaveLength(2);
    expect(chain[1].memberIds).toHaveLength(2);
  });
});
