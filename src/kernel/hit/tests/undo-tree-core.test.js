// SPDX-License-Identifier: MIT
import { OperationLog } from "../operation-log.js";
import { MolecularNode, UndoTree } from "../undo-tree-core.js";
import {
  createAddObjectOperation,
  createUndoOperation,
  createRedoOperation,
  createMoveHeadOperation,
  makeOperationId,
} from "../operation.js";

/**
 * 构造一条合法的增加对象记录
 * @param {string} source - 发起者标识
 * @param {number} n - 操作序号
 * @param {number} time - 毫秒时间标记
 * @returns {import("../operation.js").OperationRecord} 分子操作记录
 */
const makeAdd = (source, n, time) =>
  createAddObjectOperation({
    id: makeOperationId(source, n),
    source,
    time,
    chunkId: "chunk-1",
    objectId: `obj-${source}-${n}`,
    data: { type: "stroke" },
    layerStackSnapshot: [`obj-${source}-${n}`],
  });

/**
 * 构造日志与树，并逐条应用记录
 * @param {...import("../operation.js").OperationRecord} records - 分子操作记录
 * @returns {{ log: OperationLog, tree: UndoTree }} 日志与树
 */
const applyAll = (...records) => {
  const log = new OperationLog();
  const tree = new UndoTree(log);
  for (const record of records) {
    log.append(record);
    tree.applyRecord(record);
  }
  return { log, tree };
};

/**
 * 活动链的操作 id 序列
 * @param {UndoTree} tree - 树
 * @returns {string[]} 操作 id 序列
 */
const chainIds = (tree) => tree.getActiveChain().map((node) => node.shareId);

describe("构造", () => {
  test("虚拟根与初始 HEAD", () => {
    const tree = new UndoTree(new OperationLog());
    expect(tree.root.shareId).toBeNull();
    expect(tree.root.depth).toBe(0);
    expect(tree.root.parent).toBeNull();
    expect(tree.head).toBe(tree.root);
    expect(tree.getActiveChain()).toEqual([]);
  });
});

describe("追加生长", () => {
  test("commit 在 HEAD 之后追加并推进 HEAD", () => {
    const { tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200), makeAdd("alice", 3, 300));
    expect(chainIds(tree)).toEqual(["alice/op-1", "alice/op-2", "alice/op-3"]);
    expect(tree.head.shareId).toBe("alice/op-3");
    const [n1, n2, n3] = tree.getActiveChain();
    expect([n1.depth, n2.depth, n3.depth]).toEqual([1, 2, 3]);
    expect(n1.parent).toBe(tree.root);
    expect(n2.parent).toBe(n1);
    expect(n3.parent).toBe(n2);
    expect(tree.getChildrenOf(n1)).toEqual([n2]);
  });

  test("活动链查询", () => {
    const { tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200));
    expect(tree.getActiveNode("alice/op-1")).toBe(tree.getActiveChain()[0]);
    expect(tree.getActiveNode("alice/op-9")).toBeNull();
    expect(tree.isOnActiveChain("alice/op-2")).toBe(true);
    expect(tree.isOnActiveChain("alice/op-9")).toBe(false);
  });
});

describe("延迟到达的时间插入", () => {
  test("插入活动链对应位置，后继改挂且 HEAD 不变", () => {
    const { tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 300), makeAdd("bob", 1, 200));
    expect(chainIds(tree)).toEqual(["alice/op-1", "bob/op-1", "alice/op-2"]);
    expect(tree.head.shareId).toBe("alice/op-2");
    const [n1, inserted, n2] = tree.getActiveChain();
    expect(inserted.parent).toBe(n1);
    expect(n2.parent).toBe(inserted);
    expect(tree.getChildrenOf(n1)).toEqual([inserted]);
    expect(tree.getChildrenOf(inserted)).toEqual([n2]);
    expect([n1.depth, inserted.depth, n2.depth]).toEqual([1, 2, 3]);
  });

  test("晚于 HEAD 的记录追加而非插入", () => {
    const { tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("bob", 1, 400));
    expect(chainIds(tree)).toEqual(["alice/op-1", "bob/op-1"]);
    expect(tree.head.shareId).toBe("bob/op-1");
  });

  test("同毫秒按 author 字典序落位", () => {
    const { tree } = applyAll(makeAdd("bob", 1, 100), makeAdd("alice", 1, 100));
    expect(chainIds(tree)).toEqual(["alice/op-1", "bob/op-1"]);
  });

  test("同毫秒同 author 的重建按操作序号决胜", () => {
    const log = new OperationLog();
    for (const record of [makeAdd("alice", 1, 100), makeAdd("alice", 2, 100), makeAdd("alice", 3, 100)]) {
      log.append(record);
    }
    const tree = UndoTree.rebuildFromLog(log);
    expect(chainIds(tree)).toEqual(["alice/op-1", "alice/op-2", "alice/op-3"]);
  });
});

describe("HEAD 移动原语", () => {
  test("回退到链中间，下游离开活动链", () => {
    const { tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200), makeAdd("alice", 3, 300));
    expect(tree.moveHeadTo("alice/op-1")).toBe(true);
    expect(tree.head.shareId).toBe("alice/op-1");
    expect(chainIds(tree)).toEqual(["alice/op-1"]);
    expect(tree.isOnActiveChain("alice/op-3")).toBe(false);
  });

  test("移至不存在的节点返回 false，HEAD 不变", () => {
    const { tree } = applyAll(makeAdd("alice", 1, 100));
    expect(tree.moveHeadTo("alice/op-9")).toBe(false);
    expect(tree.head.shareId).toBe("alice/op-1");
  });

  test("回退后可再推进，活动链恢复", () => {
    const { tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200));
    tree.moveHeadTo("alice/op-1");
    expect(tree.moveHeadTo("alice/op-2")).toBe(true);
    expect(chainIds(tree)).toEqual(["alice/op-1", "alice/op-2"]);
  });

  test("回退后新操作在 HEAD 所指位置追加，长成新分支", () => {
    const { log, tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200));
    tree.moveHeadTo("alice/op-1");
    const record = makeAdd("bob", 1, 300);
    log.append(record);
    tree.applyRecord(record);
    expect(chainIds(tree)).toEqual(["alice/op-1", "bob/op-1"]);
    const n1 = tree.getActiveNode("alice/op-1");
    expect(tree.getChildrenOf(n1).map((node) => node.shareId)).toEqual(["alice/op-2", "bob/op-1"]);
    expect(tree.findNode("alice/op-2")).not.toBeNull();
  });
});

describe("准入与分派", () => {
  test("记录未入数据池时抛出", () => {
    const tree = new UndoTree(new OperationLog());
    expect(() => tree.applyRecord(makeAdd("alice", 1, 100))).toThrow("记录未入数据池：alice/op-1");
  });

  test("更改 HEAD 暂不支持", () => {
    const log = new OperationLog();
    const tree = new UndoTree(log);
    const moveHead = createMoveHeadOperation({
      id: "alice/op-1",
      source: "alice",
      time: 100,
      targetNodeId: "alice/op-0",
    });
    log.append(moveHead);
    expect(() => tree.applyRecord(moveHead)).toThrow("树级操作的应用随更改 HEAD 落地补全：move-head");
  });
});

describe("派生重建", () => {
  test("乱序日志重建与顺序应用同构", () => {
    const records = [makeAdd("alice", 1, 100), makeAdd("alice", 2, 300), makeAdd("bob", 1, 200)];
    const { tree: sequential } = applyAll(...records);
    const log = new OperationLog();
    for (const record of [records[0], records[2], records[1]]) {
      log.append(record);
    }
    const rebuilt = UndoTree.rebuildFromLog(log);
    expect(chainIds(rebuilt)).toEqual(chainIds(sequential));
    expect(rebuilt.getActiveChain().map((node) => node.depth)).toEqual(
      sequential.getActiveChain().map((node) => node.depth),
    );
    expect(rebuilt.head.shareId).toBe(sequential.head.shareId);
  });
});

describe("撤销", () => {
  /**
   * 构造一条撤销记录
   * @param {string} source - 发起者标识
   * @param {number} n - 操作序号
   * @param {number} time - 毫秒时间标记
   * @param {string} targetNodeId - 目标节点 id
   * @param {string} previousHeadId - 撤销前的 HEAD 位置
   * @returns {import("../operation.js").OperationRecord} 撤销操作记录
   */
  const makeUndo = (source, n, time, targetNodeId, previousHeadId) =>
    createUndoOperation({ id: makeOperationId(source, n), source, time, targetNodeId, previousHeadId });

  test("退化：目标为活动链末端时 HEAD 回退", () => {
    const { log, tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200));
    const undo = makeUndo("alice", 3, 300, "alice/op-2", "alice/op-2");
    log.append(undo);
    tree.applyRecord(undo);
    expect(chainIds(tree)).toEqual(["alice/op-1"]);
    expect(tree.head.shareId).toBe("alice/op-1");
    expect(tree.findNode("alice/op-2")).not.toBeNull();
  });

  test("一般形态：链中段目标分叉改挂，不晚于撤销的节点两侧共享", () => {
    const { log, tree } = applyAll(
      makeAdd("alice", 1, 100),
      makeAdd("alice", 2, 200),
      makeAdd("alice", 3, 300),
    );
    const undo = makeUndo("alice", 4, 400, "alice/op-2", "alice/op-3");
    log.append(undo);
    tree.applyRecord(undo);
    expect(chainIds(tree)).toEqual(["alice/op-1", "alice/op-3"]);
    expect(tree.isOnActiveChain("alice/op-2")).toBe(false);
    const op2 = tree.findNode("alice/op-2");
    expect(op2.children.map((node) => node.shareId)).toContain("alice/op-3");
    const activeOp3 = tree.getActiveNode("alice/op-3");
    expect(activeOp3.parent.shareId).toBe("alice/op-1");
    expect(op2.children.includes(activeOp3)).toBe(false);
  });

  test("截断：晚于撤销操作的节点只存在于撤销分支", () => {
    const { log, tree } = applyAll(
      makeAdd("alice", 1, 100),
      makeAdd("alice", 2, 200),
      makeAdd("alice", 3, 300),
      makeAdd("bob", 1, 350),
      makeAdd("bob", 2, 450),
    );
    const undo = makeUndo("alice", 4, 400, "alice/op-2", "bob/op-2");
    log.append(undo);
    tree.applyRecord(undo);
    expect(chainIds(tree)).toEqual(["alice/op-1", "alice/op-3", "bob/op-1", "bob/op-2"]);
    expect(tree.head.shareId).toBe("bob/op-2");
    const op2 = tree.findNode("alice/op-2");
    const originalOp3 = op2.children.find((node) => node.shareId === "alice/op-3");
    expect(originalOp3).toBeDefined();
    expect(originalOp3.children.map((node) => node.shareId)).toEqual(["bob/op-1"]);
    expect(originalOp3.children[0].children).toEqual([]);
  });

  test("被吸收：目标不在活动链上时无结构变化", () => {
    const { log, tree } = applyAll(makeAdd("alice", 1, 100));
    const undo = makeUndo("alice", 2, 200, "alice/op-9", "alice/op-1");
    log.append(undo);
    tree.applyRecord(undo);
    expect(chainIds(tree)).toEqual(["alice/op-1"]);
    expect(tree.head.shareId).toBe("alice/op-1");
  });
});

describe("超分子节点", () => {
  /**
   * 构造一条超分子成员记录
   * @param {string} source - 发起者标识
   * @param {number} n - 操作序号
   * @param {number} time - 毫秒时间标记
   * @param {string} supraOpId - 超分子 id
   * @returns {import("../operation.js").OperationRecord} 分子操作记录
   */
  const makeMember = (source, n, time, supraOpId) => ({
    ...makeAdd(source, n, time),
    supraOpId,
  });

  test("成员组凝聚为单节点，时间标记取末分子", () => {
    const log = new OperationLog();
    const tree = new UndoTree(log);
    const m1 = makeMember("alice", 1, 100, "alice/op-1");
    const m2 = makeMember("alice", 2, 500, "alice/op-1");
    log.append(m1);
    log.append(m2);
    const node = tree.applySupraNode([m1, m2]);
    expect(node.shareId).toBe("alice/op-1");
    expect(tree.getActiveChain()).toHaveLength(1);
    // 末分子时间为 500：bob 的 200 应插入超分子节点之前
    const bob = makeAdd("bob", 1, 200);
    log.append(bob);
    tree.applyRecord(bob);
    expect(chainIds(tree)).toEqual(["bob/op-1", "alice/op-1"]);
  });

  test("超分子成员不径 applyRecord 产生独立节点", () => {
    const log = new OperationLog();
    const tree = new UndoTree(log);
    const member = makeMember("alice", 1, 100, "alice/op-1");
    log.append(member);
    expect(() => tree.applyRecord(member)).toThrow("超分子成员不产生独立节点");
  });

  test("重建按末分子时间分组定序", () => {
    const log = new OperationLog();
    log.append(makeMember("alice", 1, 100, "alice/op-1"));
    log.append(makeAdd("bob", 1, 200));
    log.append(makeMember("alice", 2, 300, "alice/op-1"));
    const tree = UndoTree.rebuildFromLog(log);
    // 超分子节点时间 300，bob 200 在前
    expect(chainIds(tree)).toEqual(["bob/op-1", "alice/op-1"]);
  });

  test("空成员组不产生节点", () => {
    const tree = new UndoTree(new OperationLog());
    expect(tree.applySupraNode([])).toBeNull();
    expect(tree.getActiveChain()).toHaveLength(0);
  });
});

describe("重做", () => {
  /**
   * 构造一条重做记录
   * @param {string} source - 发起者标识
   * @param {number} n - 操作序号
   * @param {number} time - 毫秒时间标记
   * @param {string} targetUndoId - 被重做的撤销记录 id
   * @returns {import("../operation.js").OperationRecord} 重做操作记录
   */
  const makeRedo = (source, n, time, targetUndoId) =>
    createRedoOperation({ id: makeOperationId(source, n), source, time, targetUndoId });

  /**
   * 构造并应用一条撤销记录
   * @param {OperationLog} log - 操作日志
   * @param {UndoTree} tree - 时间回溯树
   * @param {string} source - 发起者标识
   * @param {number} n - 操作序号
   * @param {number} time - 毫秒时间标记
   * @param {string} targetNodeId - 目标节点 id
   * @param {string} previousHeadId - 撤销前的 HEAD 位置
   * @returns {void}
   */
  const applyUndo = (log, tree, source, n, time, targetNodeId, previousHeadId) => {
    const undo = createUndoOperation({
      id: makeOperationId(source, n),
      source,
      time,
      targetNodeId,
      previousHeadId,
    });
    log.append(undo);
    tree.applyRecord(undo);
  };

  test("基本重做：撤销目标重新激活并推进 HEAD", () => {
    const { log, tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200));
    applyUndo(log, tree, "alice", 3, 300, "alice/op-2", "alice/op-2");
    expect(tree.head.shareId).toBe("alice/op-1");
    const redo = makeRedo("alice", 4, 400, "alice/op-3");
    log.append(redo);
    tree.applyRecord(redo);
    expect(chainIds(tree)).toEqual(["alice/op-1", "alice/op-2"]);
  });

  test("多级撤销后逐级重做，无可重做时不再生效", () => {
    const { log, tree } = applyAll(
      makeAdd("alice", 1, 100),
      makeAdd("alice", 2, 200),
      makeAdd("alice", 3, 300),
    );
    applyUndo(log, tree, "alice", 4, 400, "alice/op-3", "alice/op-3");
    applyUndo(log, tree, "alice", 5, 500, "alice/op-2", "alice/op-2");
    expect(tree.head.shareId).toBe("alice/op-1");
    for (const [n, time, targetUndoId, expected] of [
      [6, 600, "alice/op-5", "alice/op-2"],
      [7, 700, "alice/op-4", "alice/op-3"],
    ]) {
      const redo = makeRedo("alice", n, time, targetUndoId);
      log.append(redo);
      tree.applyRecord(redo);
      expect(tree.head.shareId).toBe(expected);
    }
    const extra = makeRedo("alice", 8, 800, "alice/op-4");
    log.append(extra);
    tree.applyRecord(extra);
    expect(tree.head.shareId).toBe("alice/op-3");
  });

  test("撤销后的同源新工作洗掉重做", () => {
    const { log, tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200));
    applyUndo(log, tree, "alice", 3, 300, "alice/op-2", "alice/op-2");
    const newWork = makeAdd("alice", 4, 400);
    log.append(newWork);
    tree.applyRecord(newWork);
    const redo = makeRedo("alice", 5, 500, "alice/op-3");
    log.append(redo);
    tree.applyRecord(redo);
    expect(chainIds(tree)).toEqual(["alice/op-1", "alice/op-4"]);
    expect(tree.isOnActiveChain("alice/op-2")).toBe(false);
  });

  test("远端来源的新工作不洗刷重做：目标按时间标记插回、并发工作留在链上", () => {
    const { log, tree } = applyAll(makeAdd("alice", 1, 100), makeAdd("alice", 2, 200));
    applyUndo(log, tree, "alice", 3, 300, "alice/op-2", "alice/op-2");
    // 远端 bob 的并发新工作（晚于撤销）不洗刷 alice 的重做资格
    const remoteWork = makeAdd("bob", 1, 400);
    log.append(remoteWork);
    tree.applyRecord(remoteWork);
    expect(chainIds(tree)).toEqual(["alice/op-1", "bob/op-1"]);
    const redo = makeRedo("alice", 4, 500, "alice/op-3");
    log.append(redo);
    tree.applyRecord(redo);
    // op-2 回到其时间位置（bob/op-1 之前），并发工作留在链上
    expect(chainIds(tree)).toEqual(["alice/op-1", "alice/op-2", "bob/op-1"]);
    expect(tree.head.shareId).toBe("bob/op-1");
  });

  test("一般形态撤销的重做：目标按时间标记插回活动链", () => {
    const { log, tree } = applyAll(
      makeAdd("alice", 1, 100),
      makeAdd("alice", 2, 200),
      makeAdd("alice", 3, 300),
    );
    applyUndo(log, tree, "alice", 4, 400, "alice/op-2", "alice/op-3");
    // 撤销后 HEAD 是 op-3 的副本（挂在 op-1 下）
    expect(tree.head.parent.shareId).toBe("alice/op-1");
    const redo = makeRedo("alice", 5, 500, "alice/op-4");
    log.append(redo);
    tree.applyRecord(redo);
    // op-2 按时间标记插回 op-1 与 op-3 之间，HEAD 不动
    expect(tree.head.shareId).toBe("alice/op-3");
    expect(tree.head.parent.shareId).toBe("alice/op-2");
    expect(tree.isOnActiveChain("alice/op-2")).toBe(true);
  });
});
