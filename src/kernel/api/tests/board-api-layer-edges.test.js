// SPDX-License-Identifier: MIT

import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";
import { Vector } from "../../utils/math.js";

/**
 * 创建一个端（独立的 BoardCore 与 BoardApi）
 * @param {string} [source] - 端标识
 * @param {() => number} [now] - 确定性时间源（并发场景各端共享逻辑时钟）
 * @returns {{ boardCore: BoardCore, api: BoardApi }} 端
 */
function createEnd(source, now) {
  const boardCore = new BoardCore({
    width: 800,
    height: 600,
    source,
    now,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
  return { boardCore, api: new BoardApi(boardCore) };
}

/**
 * 创建并提交一个静态笔画（默认水平线 y=100，x 从 0 到 40）
 * @param {BoardApi} api - BoardApi 实例
 * @param {string} id - 对象 id
 * @param {Array<{x: number, y: number}>} [points] - 采样点
 * @returns {Promise<void>}
 */
async function createStaticStroke(api, id, points) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 0, y: 0 },
    property: { width: 2 },
    data: {
      points: points ?? [
        { x: 0, y: 100 },
        { x: 10, y: 100 },
        { x: 20, y: 100 },
        { x: 30, y: 100 },
        { x: 40, y: 100 },
      ],
    },
  });
  await api.commitObjects([id]);
}

/**
 * 判断某区块静态图中是否存在层位边（belowId 在 aboveId 之下）
 * @param {BoardCore} boardCore - 白板核心
 * @param {string} belowId - 在下者 id
 * @param {string} aboveId - 在上者 id
 * @returns {boolean} 边是否存在
 */
function hasLayerEdge(boardCore, belowId, aboveId) {
  for (const { chunk } of boardCore.chunkLoaded.values()) {
    const graph = chunk?.objectManager?.staticGraph;
    if (graph?.hasEdge?.(belowId, aboveId)) return true;
  }
  return false;
}

/**
 * 收集全部已加载区块的层位边集合（排序后可比）
 * @param {BoardCore} boardCore - 白板核心
 * @returns {string[]} 边描述列表，形如 `"chunkId:from->to"`
 */
function collectLayerEdges(boardCore) {
  const edges = [];
  for (const { chunk } of boardCore.chunkLoaded.values()) {
    const graph = chunk?.objectManager?.staticGraph;
    if (!graph) continue;
    for (const from of graph.getNodes()) {
      for (const to of graph.neighborsUnsafe(from) ?? []) {
        edges.push(`${chunk.id}:${from}->${to}`);
      }
    }
  }
  return edges.sort();
}

describe("层位边效果记录与重放", () => {
  test("撤销移动会话：对象回到选择前的层位（选择时被压在下方的关系恢复）", async () => {
    const { boardCore, api } = createEnd("a");
    await createStaticStroke(api, "x");
    // a 后创建，压在 x 之上（边 x→a）
    await createStaticStroke(api, "a");
    expect(hasLayerEdge(boardCore, "x", "a")).toBe(true);

    // 选择压在 x 之上的 a：choose 记录应携带提取边（below=[x]）
    api.beginSupra("S");
    await api.addActiveObjects(["a"], { supraKey: "S" });
    const choose = boardCore.operationLog.toArray().at(-1);
    expect(choose.type).toBe("choose-object");
    expect(choose.payload.chunks).toBeDefined();
    expect(
      choose.payload.chunks.some(
        (entry) => entry.below.includes("x") && entry.above.length === 0,
      ),
    ).toBe(true);

    // 移走（不再相交）并提交：a 的旧边被清掉
    api.modifyObject("a", { position: { x: 500, y: 500 } });
    await api.commitObjects(["a"], { supraKey: "S" });
    api.endSupra("S");
    expect(hasLayerEdge(boardCore, "x", "a")).toBe(false);
    expect(hasLayerEdge(boardCore, "a", "x")).toBe(false);

    // 一次撤销回退整个会话：位置与层位都回选择前
    const { undone } = api.undo();
    expect(undone).toBe(true);
    expect(api.queryObject("a").position).toEqual({ x: 0, y: 0 });
    expect(hasLayerEdge(boardCore, "x", "a")).toBe(true);
  });

  test("撤销删除：删除时刻的层位边恢复，删除窗口期创建的相交对象缝合居上", async () => {
    const { boardCore, api } = createEnd("a");
    await createStaticStroke(api, "x");
    await createStaticStroke(api, "a");
    expect(hasLayerEdge(boardCore, "x", "a")).toBe(true);

    await api.deleteObjects(["x"]);
    // 删除窗口期创建 c（与 x 原位置相交）
    await createStaticStroke(api, "c");
    expect(hasLayerEdge(boardCore, "a", "c")).toBe(true);

    // 显式撤销删除（跳过链上更晚的 add c）
    const deleteRecord = boardCore.operationLog
      .toArray()
      .find((record) => record.type === "delete-object");
    const { undone } = api.undo(deleteRecord.id);
    expect(undone).toBe(true);

    // x 恢复：删除前的边（x→a）保留；窗口期新对象 c 缝合为压在 x 之上
    expect(boardCore.getObjectById("x")).toBeDefined();
    expect(hasLayerEdge(boardCore, "x", "a")).toBe(true);
    expect(hasLayerEdge(boardCore, "x", "c")).toBe(true);
    expect(hasLayerEdge(boardCore, "c", "x")).toBe(false);
  });

  test("全量重放层位一致：同区块移动清除的边经提交边记录落实到重放端", async () => {
    const A = createEnd("a");
    await createStaticStroke(A.api, "x");
    await createStaticStroke(A.api, "a");
    expect(hasLayerEdge(A.boardCore, "x", "a")).toBe(true);

    // a 移走（不再相交）：提交后 a 的旧边被清
    A.api.beginSupra("S");
    await A.api.addActiveObjects(["a"], { supraKey: "S" });
    A.api.modifyObject("a", { position: { x: 500, y: 500 } });
    await A.api.commitObjects(["a"], { supraKey: "S" });
    A.api.endSupra("S");
    expect(hasLayerEdge(A.boardCore, "x", "a")).toBe(false);

    // 重放端从零应用全部记录：层位边集合与实况端逐边一致
    const B = createEnd("b");
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());
    expect(collectLayerEdges(B.boardCore)).toEqual(collectLayerEdges(A.boardCore));
    expect(hasLayerEdge(B.boardCore, "x", "a")).toBe(false);
  });

  test("增量远端应用：对端提交边经 unchoose 记录落实到本端静态图", async () => {
    const A = createEnd("a");
    const B = createEnd("b");
    await createStaticStroke(A.api, "x");
    await createStaticStroke(A.api, "y");
    const baseLength = A.boardCore.operationLog.toJSON().length;
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());
    expect(hasLayerEdge(B.boardCore, "x", "y")).toBe(true);

    // A 把 y 移走并提交：实况端 y 的层位边被清
    A.api.beginSupra("S");
    await A.api.addActiveObjects(["y"], { supraKey: "S" });
    A.api.modifyObject("y", { position: { x: 500, y: 500 } });
    await A.api.commitObjects(["y"], { supraKey: "S" });
    A.api.endSupra("S");

    // 增量到达（不经全量重放）：B 的层位边与 A 收敛一致
    const delta = A.boardCore.operationLog.toJSON().slice(baseLength);
    await B.api.applyRemoteOperations(delta);
    expect(hasLayerEdge(B.boardCore, "x", "y")).toBe(false);
    expect(collectLayerEdges(B.boardCore)).toEqual(collectLayerEdges(A.boardCore));
  });

  test("擦除分裂：分裂段继承原笔层位，重放端逐边一致，撤销恢复原笔层位", async () => {
    const A = createEnd("a");
    // 密集长笔画供一刀切两段
    const densePoints = [];
    for (let x = 0; x <= 80; x += 10) {
      densePoints.push({ x, y: 100 });
    }
    await createStaticStroke(A.api, "s1", densePoints);
    // 左/右两条覆盖笔画分别压在 s1 的两段之上（同在 y=100 相交，避开刀口 x=45）
    await createStaticStroke(A.api, "cover-l", [
      { x: 0, y: 100 },
      { x: 30, y: 100 },
    ]);
    await createStaticStroke(A.api, "cover-r", [
      { x: 50, y: 100 },
      { x: 80, y: 100 },
    ]);
    expect(hasLayerEdge(A.boardCore, "s1", "cover-l")).toBe(true);
    expect(hasLayerEdge(A.boardCore, "s1", "cover-r")).toBe(true);

    const result = await A.api.eraseData({
      points: [new Vector(45, 95), new Vector(45, 105)],
      radius: 1,
      source: "test",
    });
    expect(result.created).toHaveLength(1);
    const [splitId] = result.created;

    // 实况端：首段（回写 s1）与分裂段各自继承原层位（在对应覆盖笔画之下）
    expect(hasLayerEdge(A.boardCore, "s1", "cover-l")).toBe(true);
    expect(hasLayerEdge(A.boardCore, splitId, "cover-r")).toBe(true);
    // 分裂段 add 与原笔 modify 记录携带层位边
    const records = A.boardCore.operationLog.toArray();
    const splitAdd = records.find(
      (record) => record.type === "add-object" && record.payload.objectId === splitId,
    );
    expect(
      splitAdd.payload.chunks?.some((entry) => entry.above.includes("cover-r")),
    ).toBe(true);
    const originModify = records.find(
      (record) => record.type === "modify-object" && record.payload.objectId === "s1",
    );
    expect(
      originModify.payload.chunks?.before?.some(
        (entry) => entry.above.includes("cover-l") && entry.above.includes("cover-r"),
      ),
    ).toBe(true);
    expect(
      originModify.payload.chunks?.after?.some((entry) => entry.above.includes("cover-l")),
    ).toBe(true);

    // 重放端从零应用全部记录：层位边集合与实况端逐边一致
    const B = createEnd("b");
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());
    expect(collectLayerEdges(B.boardCore)).toEqual(collectLayerEdges(A.boardCore));

    // 撤销擦除：原笔恢复（数据与两侧层位边），分裂段移除
    const { undone } = A.api.undo();
    expect(undone).toBe(true);
    expect(A.boardCore.getObjectById("s1").data.points).toHaveLength(9);
    expect(A.boardCore.getObjectById(splitId)).toBeUndefined();
    expect(hasLayerEdge(A.boardCore, "s1", "cover-l")).toBe(true);
    expect(hasLayerEdge(A.boardCore, "s1", "cover-r")).toBe(true);
  });

  test("旧形态记录兼容：无层位边（仅层栈快照）的 add 重放回退几何居上", async () => {
    const A = createEnd("a");
    await createStaticStroke(A.api, "x");
    await createStaticStroke(A.api, "y");

    // 构造旧形态日志：去掉 chunks、补回层栈快照字段
    const legacyLog = A.boardCore.operationLog.toJSON().map((record) => {
      if (record.type !== "add-object") return record;
      const payload = { ...record.payload, layerStackSnapshot: [] };
      delete payload.chunks;
      return { ...record, payload };
    });

    const B = createEnd("b");
    const { applied } = await B.api.applyRemoteOperations(legacyLog);
    expect(applied).toBe(2);
    // 几何居上：后创建的 y 压在 x 之上，与实况端一致
    expect(B.boardCore.getObjectById("y")).toBeDefined();
    expect(hasLayerEdge(B.boardCore, "x", "y")).toBe(true);
    expect(collectLayerEdges(B.boardCore)).toEqual(collectLayerEdges(A.boardCore));
  });

  test("延迟并发：提交捕获后到达的相交对象经 unchoose 正放缝合居上，两端一致", async () => {
    let tick = 0;
    const now = () => (tick += 1000);
    const A = createEnd("a", now);
    const B = createEnd("b", now);
    await createStaticStroke(A.api, "y");
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());

    // A 选择 y 并移动（会话期间 B 并发创建 z，A 提交时不知道 z）
    A.api.beginSupra("S");
    await A.api.addActiveObjects(["y"], { supraKey: "S" });
    A.api.modifyObject("y", { position: { x: 5, y: 0 } });
    // B 并发创建与 y 相交的 z：z 居上（边 y→z）
    await createStaticStroke(B.api, "z", [
      { x: 10, y: 100 },
      { x: 30, y: 100 },
    ]);
    expect(hasLayerEdge(B.boardCore, "y", "z")).toBe(true);
    // A 提交：提交边不含 z（A 尚未见到 z）
    await A.api.commitObjects(["y"], { supraKey: "S" });
    A.api.endSupra("S");
    const unchoose = A.boardCore.operationLog
      .toArray()
      .find((record) => record.type === "unchoose-object");
    expect(
      unchoose.payload.chunks.every(
        (entry) => !entry.below.includes("z") && !entry.above.includes("z"),
      ),
    ).toBe(true);

    // 交换日志：z.add 的日志序先于 A 的 unchoose（A 侧触发尾段过渡，B 侧纯追加）；
    // 各端只投递对方未见的记录（按 source 过滤避免重复投递）
    await A.api.applyRemoteOperations(
      B.boardCore.operationLog.toJSON().filter((record) => record.source === "b"),
    );
    await B.api.applyRemoteOperations(
      A.boardCore.operationLog.toJSON().filter((record) => record.source === "a").slice(1),
    );

    // LLWW：A 的 unchoose 是日志序更晚的写，y 居上（边 z→y）；两端逐边一致
    for (const end of [A, B]) {
      expect(hasLayerEdge(end.boardCore, "z", "y")).toBe(true);
      expect(hasLayerEdge(end.boardCore, "y", "z")).toBe(false);
    }
    expect(collectLayerEdges(A.boardCore)).toEqual(collectLayerEdges(B.boardCore));
  });

  test("延迟并发：同一相交对的反向层位主张按日志序后写者胜，两端一致", async () => {
    let tick = 0;
    const now = () => (tick += 1000);
    const A = createEnd("a", now);
    const B = createEnd("b", now);
    await createStaticStroke(A.api, "x");
    await createStaticStroke(A.api, "y");
    const baseLength = A.boardCore.operationLog.toJSON().length;
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());
    expect(hasLayerEdge(B.boardCore, "x", "y")).toBe(true);

    // A 先把 x 挪走（切断 x→y 的 pickup 关联），再挪回原地压上：x 居上（主张 y→x）
    A.api.beginSupra("S1");
    await A.api.addActiveObjects(["x"], { supraKey: "S1" });
    A.api.modifyObject("x", { position: { x: 500, y: 500 } });
    await A.api.commitObjects(["x"], { supraKey: "S1" });
    A.api.endSupra("S1");
    A.api.beginSupra("S2");
    await A.api.addActiveObjects(["x"], { supraKey: "S2" });
    A.api.modifyObject("x", { position: { x: 1, y: 0 } });
    await A.api.commitObjects(["x"], { supraKey: "S2" });
    A.api.endSupra("S2");
    expect(hasLayerEdge(A.boardCore, "y", "x")).toBe(true);

    // B 并发微调 y：x 不在 pickup 下游，原层位保留（主张 x→y），提交时刻更晚
    B.api.beginSupra("T");
    await B.api.addActiveObjects(["y"], { supraKey: "T" });
    B.api.modifyObject("y", { position: { x: 2, y: 0 } });
    await B.api.commitObjects(["y"], { supraKey: "T" });
    B.api.endSupra("T");
    expect(hasLayerEdge(B.boardCore, "x", "y")).toBe(true);

    // 交换日志：B 的 unchoose 日志序更晚，其主张（x→y）在两端胜出（各端只投递对方未见的记录）
    await A.api.applyRemoteOperations(
      B.boardCore.operationLog.toJSON().filter((record) => record.source === "b"),
    );
    await B.api.applyRemoteOperations(
      A.boardCore.operationLog
        .toJSON()
        .filter((record) => record.source === "a")
        .slice(baseLength),
    );

    for (const end of [A, B]) {
      expect(hasLayerEdge(end.boardCore, "x", "y")).toBe(true);
      expect(hasLayerEdge(end.boardCore, "y", "x")).toBe(false);
    }
    expect(collectLayerEdges(A.boardCore)).toEqual(collectLayerEdges(B.boardCore));
  });

  test("修复对账：活体层位边分歧经 repairStateFromLog 对齐派生态", async () => {
    const { boardCore, api } = createEnd("a");
    await createStaticStroke(api, "x");
    await createStaticStroke(api, "y");
    expect(hasLayerEdge(boardCore, "x", "y")).toBe(true);

    // 人为破坏：删真边、加假边（绕过守卫模拟边级分歧残留）
    for (const { chunk } of boardCore.chunkLoaded.values()) {
      const graph = chunk?.objectManager?.staticGraph;
      if (graph?.hasEdge?.("x", "y")) {
        graph.deleteEdgeUnsafe("x", "y");
        graph.addEdgeUnsafe("y", "x");
      }
    }
    expect(hasLayerEdge(boardCore, "y", "x")).toBe(true);

    // 对象数据与 trash 无分歧（digest 口径不可见），层位边由 repair 对齐派生态
    const { repaired } = api.repairStateFromLog();
    expect(repaired).toBe(true);
    expect(hasLayerEdge(boardCore, "x", "y")).toBe(true);
    expect(hasLayerEdge(boardCore, "y", "x")).toBe(false);
  });

  test("延迟并发：擦除回写与并发新增交错，记录外相交对象缝合居上", async () => {
    let tick = 0;
    const now = () => (tick += 1000);
    const A = createEnd("a", now);
    const B = createEnd("b", now);
    const densePoints = [];
    for (let x = 0; x <= 80; x += 10) {
      densePoints.push({ x, y: 100 });
    }
    await createStaticStroke(A.api, "s1", densePoints);
    await B.api.applyRemoteOperations(A.boardCore.operationLog.toJSON());

    // B 并发创建跨越刀口的 z（与 s1 的两段都相交）：z 居上（边 s1→z）
    await createStaticStroke(B.api, "z", [
      { x: 30, y: 100 },
      { x: 45, y: 100 },
      { x: 60, y: 100 },
    ]);
    expect(hasLayerEdge(B.boardCore, "s1", "z")).toBe(true);

    // A 在未见 z 时擦除分裂 s1：modify.after 与分裂段 add 的层位边都不含 z
    const result = await A.api.eraseData({
      points: [new Vector(45, 95), new Vector(45, 105)],
      radius: 1,
      source: "test",
    });
    expect(result.created).toHaveLength(1);
    const [splitId] = result.created;

    // 交换日志：z.add 日志序先于擦除记录（各端只投递对方未见的记录）
    await A.api.applyRemoteOperations(
      B.boardCore.operationLog.toJSON().filter((record) => record.source === "b"),
    );
    await B.api.applyRemoteOperations(
      A.boardCore.operationLog.toJSON().filter((record) => record.source === "a").slice(1),
    );

    // LLWW：擦除记录日志序更晚，s1 与分裂段居上（边 z→s1、z→splitId）；两端逐边一致
    for (const end of [A, B]) {
      expect(hasLayerEdge(end.boardCore, "z", "s1")).toBe(true);
      expect(hasLayerEdge(end.boardCore, "z", splitId)).toBe(true);
      expect(hasLayerEdge(end.boardCore, "s1", "z")).toBe(false);
    }
    expect(collectLayerEdges(A.boardCore)).toEqual(collectLayerEdges(B.boardCore));
  });
});
