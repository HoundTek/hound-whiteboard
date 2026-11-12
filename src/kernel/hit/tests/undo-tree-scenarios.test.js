// SPDX-License-Identifier: MIT
import { OperationLog } from "../operation-log.js";
import { UndoTree } from "../undo-tree-core.js";
import {
  createAddObjectOperation,
  createUndoOperation,
  createRedoOperation,
  makeOperationId,
} from "../operation.js";

/**
 * 情景推演回归：以 (时刻, author) 构造多人日志，验证树 = f(日志) 与各增量路径。
 * 情景设定见 docs/undo-tree-kernel-example.md；节点 id 形如 "a/op-1"（a/b/c 对应 A/B/C）。
 * 各端到达顺序的双端互喂回归见 kernel/api/tests/board-api-sync.test.js。
 */

/**
 * 增加对象记录
 * @param {string} source - author 标识（a/b/c）
 * @param {number} n - 操作序号
 * @param {number} time - 毫秒时间标记
 * @param {?string} parentId - 父节点 id（本地视角）
 * @returns {import("../operation.js").OperationRecord} 分子操作记录
 */
const add = (source, n, time, parentId = null) =>
  createAddObjectOperation({
    id: makeOperationId(source, n),
    source,
    time,
    parentId,
    chunkId: "1",
    objectId: `${source}${n}`,
    data: { type: "StrokeObject" },
    layerStackSnapshot: [],
  });

/**
 * 撤销记录
 * @param {string} source - author 标识
 * @param {number} n - 操作序号
 * @param {number} time - 毫秒时间标记
 * @param {string} targetId - 目标节点 id
 * @param {string} previousHeadId - 撤销前的 HEAD 位置
 * @returns {import("../operation.js").OperationRecord} 撤销操作记录
 */
const undo = (source, n, time, targetId, previousHeadId) =>
  createUndoOperation({
    id: makeOperationId(source, n),
    source,
    time,
    targetNodeId: targetId,
    previousHeadId,
  });

/**
 * 重做记录
 * @param {string} source - author 标识
 * @param {number} n - 操作序号
 * @param {number} time - 毫秒时间标记
 * @param {string} targetUndoId - 被重做的撤销记录 id
 * @returns {import("../operation.js").OperationRecord} 重做操作记录
 */
const redo = (source, n, time, targetUndoId) =>
  createRedoOperation({
    id: makeOperationId(source, n),
    source,
    time,
    targetUndoId,
  });

/**
 * 按给定顺序入日志并重建树（回放路径）
 * @param {import("../operation.js").OperationRecord[]} records - 分子操作记录
 * @returns {UndoTree} 重建的树
 */
const replay = (records) => {
  const log = new OperationLog();
  for (const record of records) {
    log.append(record);
  }
  return UndoTree.rebuildFromLog(log);
};

/**
 * 按给定顺序逐条应用（增量路径）
 * @param {import("../operation.js").OperationRecord[]} records - 分子操作记录
 * @returns {UndoTree} 树
 */
const applyInOrder = (records) => {
  const log = new OperationLog();
  const tree = new UndoTree(log);
  for (const record of records) {
    log.append(record);
    tree.applyRecord(record);
  }
  return tree;
};

/**
 * 活动链的节点 id 序列
 * @param {UndoTree} tree - 树
 * @returns {string[]} 节点 id 序列
 */
const chainOf = (tree) => tree.getActiveChain().map((node) => node.shareId);

/**
 * 某节点（首个匹配）的子节点 id 序列
 * @param {UndoTree} tree - 树
 * @param {string} shareId - 数据池共享 id
 * @returns {string[]} 子节点 id 序列
 */
const childrenOf = (tree, shareId) =>
  (tree.findNode(shareId)?.children ?? []).map((node) => node.shareId);

/** 情景一/四的公共操作集（四个新增 → 撤销 A2 → 新增 B3） */
const scenario14Records = () => [
  add("a", 1, 0, null),
  add("b", 1, 1, "a/op-1"),
  add("a", 2, 2, "b/op-1"),
  add("b", 2, 3, "a/op-2"),
  undo("a", 3, 4, "a/op-2", "b/op-2"),
  add("b", 3, 5, "b/op-2"),
];

/**
 * 断言情景一/四的收敛树形：活动链 A1→B1→B2→B3，A2 携原位置 B2 留在旧分支
 * @param {UndoTree} tree - 树
 * @returns {void}
 */
const expectScenario14Tree = (tree) => {
  expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1", "b/op-2", "b/op-3"]);
  expect(tree.head.shareId).toBe("b/op-3");
  expect(tree.isOnActiveChain("a/op-2")).toBe(false);
  expect(childrenOf(tree, "a/op-2")).toEqual(["b/op-2"]);
  expect(childrenOf(tree, "b/op-1")).toEqual(["a/op-2", "b/op-2"]);
};

describe("情景一：跨节点撤销与并发新增", () => {
  test("回放路径", () => {
    expectScenario14Tree(replay(scenario14Records()));
  });

  test("增量路径 B 端：B3 先于 O1 到达（撤销纯应用，B3 随子树改挂）", () => {
    const records = scenario14Records();
    const order = [records[0], records[1], records[2], records[3], records[5], records[4]];
    expectScenario14Tree(applyInOrder(order));
  });

  test("增量路径 A 端：O1 先于 B3 到达（B3 按父亲 id 落位撤销分支）", () => {
    expectScenario14Tree(applyInOrder(scenario14Records()));
  });
});

describe("情景二：新增操作有网络延迟", () => {
  const records = () => [
    add("a", 1, 0, null),
    add("b", 1, 1, null),
    add("a", 2, 2, "a/op-1"),
    add("b", 2, 3, "b/op-1"),
  ];

  test("回放路径", () => {
    expect(chainOf(replay(records()))).toEqual(["a/op-1", "b/op-1", "a/op-2", "b/op-2"]);
  });

  test("增量路径 A 端：B1 插入 A1 与 A2 之间，A2 改挂到 B1 下", () => {
    const r = records();
    const tree = applyInOrder([r[0], r[2], r[1], r[3]]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1", "a/op-2", "b/op-2"]);
  });

  test("增量路径 B 端：A1 插到 B1 之前，A2 插入 B1 与 B2 之间", () => {
    const r = records();
    const tree = applyInOrder([r[1], r[0], r[3], r[2]]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1", "a/op-2", "b/op-2"]);
  });
});

describe("情景三：并发撤销与重做", () => {
  const base = () => [
    add("a", 1, 0, null),
    add("b", 1, 1, "a/op-1"),
    add("a", 2, 2, "b/op-1"),
    add("b", 2, 3, "a/op-2"),
  ];

  test("情形 1：重复撤销同一节点，重复意图被吸收", () => {
    const tree = replay([
      ...base(),
      undo("a", 3, 4, "b/op-2", "b/op-2"),
      undo("b", 3, 5, "b/op-2", "b/op-2"),
    ]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1", "a/op-2"]);
    expect(tree.head.shareId).toBe("a/op-2");
    expect(childrenOf(tree, "a/op-2")).toEqual(["b/op-2"]);
  });

  test("情形 2：不同深度的撤销级联生效（取并集）", () => {
    const tree = replay([
      ...base(),
      undo("a", 3, 4, "b/op-2", "b/op-2"),
      undo("b", 3, 5, "b/op-2", "b/op-2"),
      undo("b", 4, 5.5, "a/op-2", "a/op-2"),
    ]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1"]);
    expect(tree.head.shareId).toBe("b/op-1");
  });

  test("情形 3：被吸收的撤销不产生重做目标，发起方重做自己的撤销生效", () => {
    const tree = replay([
      ...base(),
      undo("a", 3, 4, "b/op-2", "b/op-2"),
      undo("b", 3, 5, "b/op-2", "b/op-2"),
      redo("a", 4, 5.5, "a/op-3"),
    ]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1", "a/op-2", "b/op-2"]);
    expect(tree.head.shareId).toBe("b/op-2");
  });

  test("情形 4：先撤中间节点再撤末端，长出分叉", () => {
    const tree = replay([
      ...base(),
      undo("a", 3, 4, "a/op-2", "b/op-2"),
      undo("b", 3, 5, "b/op-2", "b/op-2"),
    ]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1"]);
    expect(childrenOf(tree, "b/op-1")).toEqual(["a/op-2", "b/op-2"]);
    expect(childrenOf(tree, "a/op-2")).toEqual(["b/op-2"]);
  });

  test("情形 5：先撤末端再撤中间节点，保持直链", () => {
    const tree = replay([
      ...base(),
      undo("b", 3, 4, "b/op-2", "b/op-2"),
      undo("a", 3, 5, "a/op-2", "b/op-2"),
    ]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1"]);
    expect(childrenOf(tree, "b/op-1")).toEqual(["a/op-2"]);
    expect(childrenOf(tree, "a/op-2")).toEqual(["b/op-2"]);
  });
});

describe("情景四：全程离线，最后一次性完全同步", () => {
  test("回放路径：与情景一殊途同归", () => {
    const records = [
      add("a", 1, 0, null),
      add("b", 1, 1, null),
      add("a", 2, 2, "a/op-1"),
      add("b", 2, 3, "b/op-1"),
      undo("a", 3, 4, "a/op-2", "a/op-2"),
      add("b", 3, 5, "b/op-2"),
    ];
    expectScenario14Tree(replay(records));
  });

});

describe("情景五：撤销与迟到的改挂范围内节点", () => {
  test("回放路径：X 同时留在原位置与撤销分支", () => {
    const tree = replay([
      add("a", 1, 0, null),
      add("b", 1, 1, "a/op-1"),
      add("a", 2, 2, "b/op-1"),
      add("b", 2, 3, "a/op-2"),
      add("b", 3, 4, "b/op-2"),
      undo("a", 3, 5, "a/op-2", "b/op-2"),
    ]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1", "b/op-2", "b/op-3"]);
    expect(tree.head.shareId).toBe("b/op-3");
    // 原位置：A2 → B2 → X 完整保留（X 不晚于撤销，截断留下）
    expect(childrenOf(tree, "a/op-2")).toEqual(["b/op-2"]);
    const originalB2 = tree.findNode("a/op-2").children[0];
    expect(originalB2.children.map((node) => node.shareId)).toEqual(["b/op-3"]);
  });

});

describe("情景六：三人同刻并发新增", () => {
  const records = () => [
    add("a", 1, 0, null),
    add("a", 2, 1, "a/op-1"),
    add("b", 1, 1, "a/op-1"),
    add("c", 1, 1, "a/op-1"),
    add("c", 2, 2, "c/op-1"),
  ];

  test("回放路径：同刻按 author 决胜", () => {
    expect(chainOf(replay(records()))).toEqual([
      "a/op-1", "a/op-2", "b/op-1", "c/op-1", "c/op-2",
    ]);
  });

  test("增量路径：C 端视角的乱序到达整理为同一链", () => {
    const r = records();
    const tree = applyInOrder([r[0], r[3], r[1], r[2], r[4]]);
    expect(chainOf(tree)).toEqual(["a/op-1", "a/op-2", "b/op-1", "c/op-1", "c/op-2"]);
  });
});

describe("情景七：多 author 的改挂", () => {
  const records = () => [
    add("a", 1, 0, null),
    add("b", 1, 1, "a/op-1"),
    add("c", 1, 2, "b/op-1"),
    add("a", 2, 3, "c/op-1"),
    undo("a", 3, 4, "b/op-1", "a/op-2"),
    add("c", 2, 5, "a/op-2"),
  ];

  const expectTree = (tree) => {
    expect(chainOf(tree)).toEqual(["a/op-1", "c/op-1", "a/op-2", "c/op-2"]);
    expect(tree.head.shareId).toBe("c/op-2");
    expect(tree.isOnActiveChain("b/op-1")).toBe(false);
    expect(childrenOf(tree, "b/op-1")).toEqual(["c/op-1"]);
  };

  test("回放路径", () => {
    expectTree(replay(records()));
  });

  test("增量路径 C 端：C2 先于 O1 到达（撤销纯应用，多 author 链一并改挂）", () => {
    const r = records();
    expectTree(applyInOrder([r[0], r[1], r[2], r[3], r[5], r[4]]));
  });
});

describe("情景八：三方撤销、重做与新增赛跑", () => {
  test("回放路径：最后生效的意图定音，父不在活动链按时间插入", () => {
    const tree = replay([
      add("a", 1, 0, null),
      add("b", 1, 1, "a/op-1"),
      add("c", 1, 2, "b/op-1"),
      undo("a", 2, 3, "c/op-1", "c/op-1"),
      redo("a", 3, 4, "a/op-2"),
      undo("b", 2, 5, "c/op-1", "c/op-1"),
      add("c", 2, 6, "c/op-1"),
    ]);
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1", "c/op-2"]);
    expect(tree.head.shareId).toBe("c/op-2");
    expect(tree.isOnActiveChain("c/op-1")).toBe(false);
    expect(childrenOf(tree, "b/op-1")).toEqual(["c/op-1", "c/op-2"]);
  });

});

describe("情景九：重做与并发新增", () => {
  const records = () => [
    add("a", 1, 0, null),
    add("b", 1, 1, "a/op-1"),
    add("a", 2, 2, "b/op-1"),
    undo("a", 3, 3, "a/op-2", "a/op-2"),
    add("b", 2, 4, "a/op-2"),
    redo("a", 4, 5, "a/op-3"),
  ];

  const expectTree = (tree) => {
    // 远端（b）的新工作不洗刷 a 的重做：a/op-2 按时间标记插回 b/op-2 之前
    expect(chainOf(tree)).toEqual(["a/op-1", "b/op-1", "a/op-2", "b/op-2"]);
    expect(tree.head.shareId).toBe("b/op-2");
    expect(tree.isOnActiveChain("a/op-2")).toBe(true);
  };

  test("回放路径：远端新工作不洗刷重做，目标按时间标记插回", () => {
    expectTree(replay(records()));
  });

  test("增量路径 B 端：O1 后于 O2 到达（撤销纯应用，截断殊途同归）", () => {
    const r = records();
    expectTree(applyInOrder([r[0], r[1], r[2], r[4], r[3], r[5]]));
  });

});
