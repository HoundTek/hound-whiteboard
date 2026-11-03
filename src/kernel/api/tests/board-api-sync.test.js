// SPDX-License-Identifier: MIT

import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";
import {
  createAddObjectOperation,
  createUndoOperation,
  createRedoOperation,
  makeOperationId,
} from "../../hit/operation.js";
import { Chunk } from "../../chunk/chunk.js";

/**
 * 双端同步回归：完全按 docs/undo-tree-kernel-example.md 各端的到达顺序互喂记录，
 * 验证「插入与重放的边界」分流与全量重建兜底下两端收敛到同一棵树、同一 HEAD、同一状态。
 * 节点 id 形如 "a/op-1"（a/b/c 对应情景中的 A/B/C）。
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
 * 增加对象记录
 * @param {string} source - author 标识
 * @param {number} n - 操作序号
 * @param {number} time - 毫秒时间标记
 * @param {?string} parentId - 父节点 id（创建时的本地视角）
 * @returns {import("../../hit/operation.js").OperationRecord} 分子操作记录
 */
const add = (source, n, time, parentId = null) =>
  createAddObjectOperation({
    id: makeOperationId(source, n),
    source,
    time,
    parentId,
    chunkId: "1",
    objectId: `${source}${n}`,
    data: {
      type: "StrokeObject",
      id: `${source}${n}`,
      position: { x: 0, y: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    },
    layerStackSnapshot: [],
  });

/**
 * 撤销记录
 * @param {string} source - author 标识
 * @param {number} n - 操作序号
 * @param {number} time - 毫秒时间标记
 * @param {string} targetId - 目标节点 id
 * @param {string} previousHeadId - 撤销前的 HEAD 位置
 * @returns {import("../../hit/operation.js").OperationRecord} 撤销操作记录
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
 * @returns {import("../../hit/operation.js").OperationRecord} 重做操作记录
 */
const redo = (source, n, time, targetUndoId) =>
  createRedoOperation({
    id: makeOperationId(source, n),
    source,
    time,
    targetUndoId,
  });

/**
 * 按到达顺序逐条喂入一端
 * @param {BoardApi} api - BoardApi 实例
 * @param {import("../../hit/operation.js").OperationRecord[]} records - 记录序列
 * @returns {void}
 */
const feed = (api, records) => {
  for (const record of records) {
    api.applyRemoteOperations([record]);
  }
};

/**
 * 树结构签名（含分支与共享节点的全部出现位置）
 * @param {import("../../hit/undo-tree-core.js").UndoTree} tree - 树
 * @returns {string} 结构签名
 */
const signatureOf = (tree) => {
  const walk = (node) => `${node.shareId ?? "root"}[${node.children.map(walk).join(",")}]`;
  return walk(tree.root);
};

/**
 * 活动链的节点 id 序列
 * @param {import("../../hit/undo-tree-core.js").UndoTree} tree - 树
 * @returns {string[]} 节点 id 序列
 */
const chainOf = (tree) => tree.getActiveChain().map((node) => node.shareId);

/**
 * 断言多端收敛：同一结构签名、同一 HEAD、同一对象状态集
 * @param {Array<{ boardCore: BoardCore }>} ends - 端集合
 * @param {string[]} expectedChain - 期望的活动链 id 序列
 * @param {string[]} expectedObjects - 期望在场对象 id 集合
 * @returns {void}
 */
const expectConverged = (ends, expectedChain, expectedObjects) => {
  const signatures = ends.map((end) => signatureOf(end.boardCore.undoTree));
  for (const signature of signatures) {
    expect(signature).toBe(signatures[0]);
  }
  for (const end of ends) {
    expect(chainOf(end.boardCore.undoTree)).toEqual(expectedChain);
    expect([...end.boardCore.objectLoaded.keys()].sort()).toEqual([...expectedObjects].sort());
  }
};

describe("情景四：全程离线，最后一次性完全同步", () => {
  // A1(a/op-1,t0) B1(b/op-1,t1) A2(a/op-2,t2) B2(b/op-2,t3) U(a/op-3,t4 撤销 A2) B3(b/op-3,t5)
  const records = () => ({
    a1: add("a", 1, 0, null),
    b1: add("b", 1, 1, null),
    a2: add("a", 2, 2, "a/op-1"),
    b2: add("b", 2, 3, "b/op-1"),
    u: undo("a", 3, 4, "a/op-2", "a/op-2"),
    b3: add("b", 3, 5, "b/op-2"),
  });

  test("A 端增量视角：本地 A1、A2、U，后收 B1、B2、B3（B1/B2 落在 U 前，触发重建）", () => {
    const r = records();
    const endA = createEnd("a");
    const endB = createEnd("b");
    feed(endA.api, [r.a1, r.a2, r.u, r.b1, r.b2, r.b3]);
    feed(endB.api, [r.b1, r.b2, r.b3, r.a1, r.a2, r.u]);
    expectConverged(
      [endA, endB],
      ["a/op-1", "b/op-1", "b/op-2", "b/op-3"],
      ["a1", "b1", "b2", "b3"],
    );
    // U 重估为一般形态：A2 携原位置 B2 留在旧分支
    expect(endA.boardCore.undoTree.isOnActiveChain("a/op-2")).toBe(false);
  });

  test("B 端增量视角：本地 B1、B2、B3，后收 A1、A2、U（U 纯应用）", () => {
    const r = records();
    const endA = createEnd("a");
    const endB = createEnd("b");
    feed(endB.api, [r.b1, r.b2, r.b3, r.a1, r.a2, r.u]);
    feed(endA.api, [r.a1, r.a2, r.u, r.b1, r.b2, r.b3]);
    expectConverged(
      [endA, endB],
      ["a/op-1", "b/op-1", "b/op-2", "b/op-3"],
      ["a1", "b1", "b2", "b3"],
    );
  });
});

describe("情景五：撤销与迟到的改挂范围内节点", () => {
  // A1 B1 A2 B2 X(b/op-3,t4) O1(a/op-3,t5 撤销 A2)
  const records = () => ({
    a1: add("a", 1, 0, null),
    b1: add("b", 1, 1, "a/op-1"),
    a2: add("a", 2, 2, "b/op-1"),
    b2: add("b", 2, 3, "a/op-2"),
    x: add("b", 3, 4, "b/op-2"),
    o1: undo("a", 3, 5, "a/op-2", "b/op-2"),
  });

  test("A 端：O1 先应用，X 迟到落入改挂范围（触发重建，X 同时进入原位置与撤消分支）", () => {
    const r = records();
    const endA = createEnd("a");
    const endB = createEnd("b");
    feed(endA.api, [r.a1, r.b1, r.a2, r.b2, r.o1, r.x]);
    feed(endB.api, [r.a1, r.b1, r.a2, r.b2, r.x, r.o1]);
    expectConverged(
      [endA, endB],
      ["a/op-1", "b/op-1", "b/op-2", "b/op-3"],
      ["a1", "b1", "b2", "b3"],
    );
    // 原位置：A2 → B2 → X 完整保留（截断以撤销时间为准，与到达时刻无关）
    const a2Node = endA.boardCore.undoTree.findNode("a/op-2");
    expect(a2Node.children.map((n) => n.shareId)).toEqual(["b/op-2"]);
    expect(a2Node.children[0].children.map((n) => n.shareId)).toEqual(["b/op-3"]);
  });
});

describe("情景八：三方撤销、重做与新增赛跑", () => {
  // A1 B1 C1 | O1(a/op-2,t3 撤 C1) O2(a/op-3,t4 重做) O3(b/op-2,t5 撤 C1) O4(c/op-2,t6 新增 C2 父 C1)
  const records = () => ({
    a1: add("a", 1, 0, null),
    b1: add("b", 1, 1, "a/op-1"),
    c1: add("c", 1, 2, "b/op-1"),
    o1: undo("a", 2, 3, "c/op-1", "c/op-1"),
    o2: redo("a", 3, 4, "a/op-2"),
    o3: undo("b", 2, 5, "c/op-1", "c/op-1"),
    o4: add("c", 2, 6, "c/op-1"),
  });

  test("A 端全程纯应用 / B 端 O1 落在 O3 前触发重建 / C 端 O2 落在 O4 前触发重建", () => {
    const r = records();
    const endA = createEnd("a");
    const endB = createEnd("b");
    const endC = createEnd("c");
    feed(endA.api, [r.a1, r.b1, r.c1, r.o1, r.o2, r.o3, r.o4]);
    feed(endB.api, [r.a1, r.b1, r.c1, r.o3, r.o1, r.o2, r.o4]);
    feed(endC.api, [r.a1, r.b1, r.c1, r.o4, r.o1, r.o2, r.o3]);
    // 撤 → 重做 → 再撤：B 的撤销是最后生效的意图；C2 的父不在活动链按时间插入
    expectConverged(
      [endA, endB, endC],
      ["a/op-1", "b/op-1", "c/op-2"],
      ["a1", "b1", "c2"],
    );
  });
});

describe("情景九：重做与并发新增", () => {
  // A1 B1 A2 | O1(a/op-3,t3 撤 A2) O2(b/op-2,t4 新增 B2 父 A2) O3(a/op-4,t5 重做 O1)
  const records = () => ({
    a1: add("a", 1, 0, null),
    b1: add("b", 1, 1, "a/op-1"),
    a2: add("a", 2, 2, "b/op-1"),
    o1: undo("a", 3, 3, "a/op-2", "a/op-2"),
    o2: add("b", 2, 4, "a/op-2"),
    o3: redo("a", 4, 5, "a/op-3"),
  });

  test("A 端：本地重做先生效，O2 到达触发重建后重做仍保持；B 端：纯应用殊途同归", () => {
    const r = records();
    const endA = createEnd("a");
    const endB = createEnd("b");
    feed(endA.api, [r.a1, r.b1, r.a2, r.o1, r.o3, r.o2]);
    feed(endB.api, [r.a1, r.b1, r.a2, r.o2, r.o1, r.o3]);
    // 远端（b）的并发新工作不洗刷 a 的重做：A2 按时间标记插回 B2 之前
    expectConverged(
      [endA, endB],
      ["a/op-1", "b/op-1", "a/op-2", "b/op-2"],
      ["a1", "b1", "a2", "b2"],
    );
    // 重做记录留在日志中（携带目标撤销 id，各端凭纯日志谓词一致生效）
    expect(endA.boardCore.operationLog.get("a/op-4").type).toBe("redo");
    expect(endA.boardCore.operationLog.get("a/op-4").payload.targetUndoId).toBe("a/op-3");
  });
});

describe("重做与并发新增的投递交错（回归）", () => {
  /**
   * 创建并提交一个笔画对象
   * @param {{ api: BoardApi }} end - 端
   * @param {string} id - 对象 id
   * @returns {Promise<void>}
   */
  const create = async (end, id) => {
    end.api.createObject("StrokeObject", {
      id,
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    });
    await end.api.commitObjects([id]);
  };

  /**
   * 增量泵：把 from 端新记录以线上 JSON 形态投递给 to 端
   * @param {{ boardCore: BoardCore, api: BoardApi }} from - 发送端
   * @param {{ boardCore: BoardCore, api: BoardApi }} to - 接收端
   * @returns {void}
   */
  const pump = (from, to) => {
    const seen = new Set(to.boardCore.operationLog.toJSON().map((r) => r.id));
    const fresh = from.boardCore.operationLog
      .toJSON()
      .filter((r) => !seen.has(r.id));
    if (fresh.length > 0) {
      to.api.applyRemoteOperations(JSON.parse(JSON.stringify(fresh)));
    }
  };

  test("远端新增先于本地重做到达：本端重做照常生效，两端收敛", async () => {
    const A = createEnd("a");
    const B = createEnd("b");
    await create(A, "a/1");
    pump(A, B);
    expect(A.api.undo().undone).toBe(true);
    await create(B, "b/1");
    // A 的撤销先到 B（同源保序：重做在其撤销之后到达）；
    // B 的新增先于 A 的重做到达 A（曾洗掉 A 的重做资格：本端不发效果、对端生效，双端永久分歧）
    pump(A, B);
    pump(B, A);
    expect(A.api.redo().redone).toBe(true);
    expect(A.boardCore.getObjectById("a/1")).toBeDefined();
    pump(A, B);

    // 两端收敛：x 与 y 都在，日志与 HEAD 一致
    const digest = (end) =>
      JSON.stringify({
        ids: end.boardCore.getAllObjects().map((o) => o.id).sort(),
        logIds: end.boardCore.operationLog.toJSON().map((r) => r.id).sort(),
        head: end.boardCore.undoTree.head?.shareId ?? null,
      });
    expect(digest(B)).toBe(digest(A));
    expect(B.boardCore.getObjectById("a/1")).toBeDefined();
    expect(B.boardCore.getObjectById("b/1")).toBeDefined();
  });

  test("本端新工作洗刷重做：不发记录（发射即生效不变式）", async () => {
    const A = createEnd("a");
    await create(A, "a/1");
    A.api.undo();
    await create(A, "a/2");
    const before = A.boardCore.operationLog.size;
    expect(A.api.redo().redone).toBe(false);
    expect(A.boardCore.operationLog.size).toBe(before);
  });
});

describe("远端会话全序列应用（实时双端驱动）", () => {
  // 与上述手工记录情景不同，此处由 A 端真实会话驱动物化记录，按到达批泵给 B 端
  test("close-supra 折叠对远端为零过渡：位置定格不回弹、远程选择消退", async () => {
    const A = createEnd("a");
    const B = createEnd("b");
    // 增量泵：把 from 端新记录以线上 JSON 形态投递给 to 端
    const pump = (from, to) => {
      const seen = new Set(to.boardCore.operationLog.toJSON().map((r) => r.id));
      const fresh = from.boardCore.operationLog
        .toJSON()
        .filter((r) => !seen.has(r.id));
      if (fresh.length > 0) {
        to.api.applyRemoteOperations(JSON.parse(JSON.stringify(fresh)));
      }
    };

    A.api.createObject("StrokeObject", {
      id: "a/1",
      position: { x: 100, y: 100 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    });
    await A.api.commitObjects(["a/1"]);
    pump(A, B);

    // remote-activity 通知计数：装饰层凭它重拉对象摘要（选中框归位的触发缝）
    const notices = [];
    B.boardCore.activityEventBus.on("remote-activity", (e) => notices.push(e));

    A.api.beginSupra("S");
    await A.api.addActiveObjects(["a/1"], { supraKey: "S" });
    pump(A, B);
    expect(B.api.queryRemoteChoices()).toEqual([{ source: "a", ids: ["a/1"] }]);
    expect(notices).toHaveLength(1);

    const molId = A.api.beginMol(["a/1"], { supraKey: "S" });
    A.api.amendMol(molId, { "a/1": { position: { x: 200, y: 200 } } });
    A.api.endMol(molId);
    pump(A, B);
    expect(B.api.queryObject("a/1").position).toEqual({ x: 200, y: 200 });
    // 远程活动对象的修改效果同样触发装饰刷新通知（否则选中框停留在选择前缓存）
    expect(notices).toHaveLength(2);
    expect(notices[1].ids).toContain("a/1");

    // Enter：提交与闭合同批到达；折叠是纯树操作，远端效果零回滚
    await A.api.commitObjects(["a/1"], { supraKey: "S" });
    A.api.endSupra("S");
    pump(A, B);
    expect(B.api.queryObject("a/1").position).toEqual({ x: 200, y: 200 });
    expect(B.api.queryRemoteChoices()).toEqual([]);
    expect(B.boardCore.activeObjectManager.has("a/1")).toBe(false);
    expect(notices).toHaveLength(3);

    // 远端撤销聚合：对端同步回选择前
    A.api.undo();
    pump(A, B);
    expect(B.api.queryObject("a/1").position).toEqual({ x: 100, y: 100 });
  });

  test("多对象手势：同分子成员增量归并后远端效果不丢（第二对象不回弹）", async () => {
    const A = createEnd("a");
    const B = createEnd("b");
    const pump = (from, to) => {
      const seen = new Set(to.boardCore.operationLog.toJSON().map((r) => r.id));
      const fresh = from.boardCore.operationLog
        .toJSON()
        .filter((r) => !seen.has(r.id));
      if (fresh.length > 0) {
        to.api.applyRemoteOperations(JSON.parse(JSON.stringify(fresh)));
      }
    };

    for (const [n, y] of [[1, 100], [2, 300]]) {
      A.api.createObject("StrokeObject", {
        id: `a/${n}`,
        position: { x: 100, y },
        property: { width: 2 },
        data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      });
      await A.api.commitObjects([`a/${n}`]);
    }
    pump(A, B);

    const notices = [];
    B.boardCore.activityEventBus.on("remote-activity", (e) => notices.push(e));

    A.api.beginSupra("S");
    await A.api.addActiveObjects(["a/1", "a/2"], { supraKey: "S" });
    pump(A, B);

    // 一次手势覆盖两个对象：同 molId 的两条 modify 同批到达，第二条增量归并进分子节点
    const molId = A.api.beginMol(["a/1", "a/2"], { supraKey: "S" });
    A.api.amendMol(molId, {
      "a/1": { position: { x: 200, y: 100 } },
      "a/2": { position: { x: 200, y: 300 } },
    });
    A.api.endMol(molId);
    pump(A, B);
    // 归并就地改节点：过渡序列若取在树变更后，第二条成员的效果会被判为零过渡丢掉
    expect(B.api.queryObject("a/1").position).toEqual({ x: 200, y: 100 });
    expect(B.api.queryObject("a/2").position).toEqual({ x: 200, y: 300 });
    expect(notices.at(-1).ids).toEqual(expect.arrayContaining(["a/1", "a/2"]));

    await A.api.commitObjects(["a/1", "a/2"], { supraKey: "S" });
    A.api.endSupra("S");
    pump(A, B);
    expect(B.api.queryObject("a/1").position).toEqual({ x: 200, y: 100 });
    expect(B.api.queryObject("a/2").position).toEqual({ x: 200, y: 300 });
    expect(B.api.queryRemoteChoices()).toEqual([]);

    A.api.undo();
    pump(A, B);
    expect(B.api.queryObject("a/1").position).toEqual({ x: 100, y: 100 });
    expect(B.api.queryObject("a/2").position).toEqual({ x: 100, y: 300 });
  });
});

describe("远端修改的区块归属同步", () => {
  /**
   * 对象在已加载区块静态图中的归属
   * @param {BoardCore} boardCore - 白板核心
   * @param {string} objectId - 对象 id
   * @returns {number[]} 区块 id 数组
   */
  const chunksOf = (boardCore, objectId) => {
    const out = [];
    for (const { chunk } of boardCore.chunkLoaded.values()) {
      if (chunk?.objectManager?.staticGraph?.hasNode?.(objectId)) {
        out.push(chunk.id);
      }
    }
    return out;
  };

  /**
   * 双端泵：把 from 的新记录喂给 to
   * @param {{ boardCore: BoardCore, api: BoardApi }} from - 来源端
   * @param {{ boardCore: BoardCore, api: BoardApi }} to - 目标端
   * @returns {void}
   */
  const pump = (from, to) => {
    const seen = new Set(to.boardCore.operationLog.toJSON().map((r) => r.id));
    const fresh = from.boardCore.operationLog
      .toJSON()
      .filter((r) => !seen.has(r.id));
    if (fresh.length > 0) {
      to.api.applyRemoteOperations(JSON.parse(JSON.stringify(fresh)));
    }
  };

  /**
   * 建立含两个对象的 A 端并把记录喂给 B
   * @returns {Promise<{ A: Object, B: Object }>} 双端
   */
  const setupEnds = async () => {
    const A = createEnd("a");
    const B = createEnd("b");
    A.api.createObject("StrokeObject", {
      id: "a/1",
      position: { x: 100, y: 100 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    });
    await A.api.commitObjects(["a/1"]);
    pump(A, B);
    return { A, B };
  };

  test("远端 modify 跨区块移动：静态图归属与覆盖索引随补丁迁移", async () => {
    const { A, B } = await setupEnds();
    const fromChunk = Chunk.worldToChunkId({ x: 100, y: 100 }, 800, 600);
    const toChunk = Chunk.worldToChunkId({ x: 950, y: 150 }, 800, 600);
    expect(chunksOf(B.boardCore, "a/1")).toEqual([fromChunk]);

    await A.api.addActiveObjects(["a/1"]);
    A.api.modifyObject("a/1", { position: { x: 950, y: 150 } });
    await A.api.commitObjects(["a/1"]);
    pump(A, B);

    // 远端应用 modify 后：对象从原区块静态图迁出、迁入目标区块，覆盖索引同步
    expect(chunksOf(B.boardCore, "a/1")).toEqual([toChunk]);
    expect([...(B.boardCore.getObjectCoverChunks("a/1") ?? [])]).toEqual([
      toChunk,
    ]);
  });

  test("远端撤销跨区块移动：逆放同样迁移归属", async () => {
    const { A, B } = await setupEnds();
    const fromChunk = Chunk.worldToChunkId({ x: 100, y: 100 }, 800, 600);
    const toChunk = Chunk.worldToChunkId({ x: 950, y: 150 }, 800, 600);

    await A.api.addActiveObjects(["a/1"]);
    A.api.modifyObject("a/1", { position: { x: 950, y: 150 } });
    await A.api.commitObjects(["a/1"]);
    pump(A, B);
    expect(chunksOf(B.boardCore, "a/1")).toEqual([toChunk]);

    A.api.undo();
    pump(A, B);
    expect(chunksOf(B.boardCore, "a/1")).toEqual([fromChunk]);
    expect([...(B.boardCore.getObjectCoverChunks("a/1") ?? [])]).toEqual([
      fromChunk,
    ]);
  });
});

describe("远端记录写入边界", () => {
  test("已有记录幂等，同 ID 不同内容显式拒绝", () => {
    const A = createEnd("a");
    const record = add("a", 1, 100);
    expect(A.api.applyRemoteOperations([record])).toEqual({ applied: 1 });
    const before = A.boardCore.getObjectById("a1").serialize();

    expect(A.api.applyRemoteOperations([record])).toEqual({ applied: 0 });
    expect(A.boardCore.operationLog.size).toBe(1);
    expect(A.boardCore.getObjectById("a1").serialize()).toEqual(before);

    const conflict = JSON.parse(JSON.stringify(record));
    conflict.payload.data.position.x = 999;
    expect(() => A.api.applyRemoteOperations([conflict])).toThrow("内容冲突");
    expect(A.boardCore.getObjectById("a1").serialize()).toEqual(before);
  });

  test("整批预校验失败时不写入前缀记录", () => {
    const A = createEnd("a");
    const first = add("a", 1, 100);
    const invalid = add("a", 2, 200, "a/op-1");
    delete invalid.payload.data;

    expect(() => A.api.applyRemoteOperations([first, invalid])).toThrow("data");
    expect(A.boardCore.operationLog.size).toBe(0);
    expect(A.boardCore.getObjectById("a1") == null).toBe(true);

    expect(A.api.applyRemoteOperations([first])).toEqual({ applied: 1 });
    expect(A.boardCore.getObjectById("a1")).toBeDefined();
  });

  test("旧形态超分子迟到成员并入既有节点并补齐对象效果", () => {
    const A = createEnd("a");
    const first = add("a", 1, 100);
    const second = add("a", 2, 200, "a/op-1");
    first.supraOpId = "a/op-1";
    second.supraOpId = "a/op-1";

    A.api.applyRemoteOperations([first]);
    A.api.applyRemoteOperations([second]);
    expect(A.boardCore.undoTree.head.memberIds).toEqual(["a/op-1", "a/op-2"]);
    expect(A.boardCore.getObjectById("a1")).toBeDefined();
    expect(A.boardCore.getObjectById("a2")).toBeDefined();
  });

  test("undo 目标迟到造成的派生链分歧可从相同日志重建", () => {
    const a1 = add("a", 1, 10000);
    const c1 = add("c", 1, 20000);
    const b1 = add("b", 1, 100);
    const b2 = undo("b", 2, 200, "a/op-1", "c/op-1");
    b2.parentId = "c/op-1";
    const canonical = createEnd("canonical");
    const divergent = createEnd("divergent");
    canonical.api.applyRemoteOperations([b1, a1, c1, b2]);
    divergent.api.applyRemoteOperations([b1, c1, b2]);
    divergent.api.applyRemoteOperations([a1]);

    expect(divergent.boardCore.operationLog.toJSON().map((r) => r.id).sort()).toEqual(
      canonical.boardCore.operationLog.toJSON().map((r) => r.id).sort(),
    );
    expect(divergent.api.queryChainHash()).not.toBe(canonical.api.queryChainHash());
    expect(divergent.api.repairChainFromLog().repaired).toBe(true);
    expect(divergent.api.queryChainHash()).toBe(canonical.api.queryChainHash());
    expect(divergent.api.queryStateHash()).toBe(canonical.api.queryStateHash());
    expect(divergent.boardCore.getObjectById("a1") == null).toBe(true);
  });

  test("同源较新远端记录推进后续本地提交时间水位", async () => {
    const boardCore = new BoardCore({
      width: 800,
      height: 600,
      source: "a",
      now: () => 150,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const api = new BoardApi(boardCore);
    api.applyRemoteOperations([add("a", 1, 200)]);
    api.createObject("StrokeObject", {
      id: "a/local",
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    });
    await api.commitObjects(["a/local"]);

    expect(boardCore.operationLog.get("a/op-2").time).toBe(200);
    expect(boardCore.getObjectById("a/local")).toBeDefined();
  });
});
