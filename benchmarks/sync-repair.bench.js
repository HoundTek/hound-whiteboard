/**
 * @file 同步局部自愈与链重建基准
 * @description 以毫秒对比 1,000/10,000 记录下局部修复、摘要查询与链重建成本；决策单位是成本是否随 N 增长，故不用 ops/sec。
 * @module benchmarks/sync-repair
 * @author Zhou Chenyu
 */

import { BoardCore } from "../src/kernel/board/board-core.js";
import { BoardApi } from "../src/kernel/api/board-api.js";
import { createDefaultAomRenderHooks } from "../src/kernel/board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../src/kernel/board/persistence-adapter.js";
import { createAddObjectOperation, createUndoOperation } from "../src/kernel/hit/operation.js";
import { printHeader, printFooter } from "./helpers.js";

/** 测量轮数。 */
const ROUNDS = 5;

/**
 * 创建白板端
 * @param {string} source - 来源
 * @returns {{boardCore: BoardCore, api: BoardApi}} 白板端
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
 * 创建并提交笔画
 * @param {BoardApi} api - 内核 API
 * @param {string} id - 对象 id
 * @param {{x: number, y: number}} position - 位置
 * @returns {Promise<void>}
 */
async function createStroke(api, id, position) {
  api.createObject("StrokeObject", {
    id,
    position,
    property: { width: 2 },
    data: {
      points: [
        { x: position.x, y: position.y },
        { x: position.x + 10, y: position.y },
      ],
    },
  });
  await api.commitObjects([id]);
}

/**
 * 建立指定记录规模的夹具
 * @param {number} count - 基础记录数
 * @returns {Promise<{boardCore: BoardCore, api: BoardApi, targetId: string, overlapIds: string[]}>} 夹具
 */
async function createFixture(count) {
  const end = createEnd("bench");
  for (let index = 0; index < count; index += 1) {
    await createStroke(end.api, `bench/${index + 1}`, { x: 0, y: index * 20 });
  }
  const overlapIds = ["bench/overlap-a", "bench/overlap-b"];
  for (const id of overlapIds) await createStroke(end.api, id, { x: 0, y: 0 });
  await end.api.flushProjection();
  if (end.boardCore.operationLog.size < count + 2 || end.boardCore.getAllObjects().length < count + 2) {
    throw new Error("同步基准夹具为空或记录数不足");
  }
  const chunk = [...end.boardCore.chunkLoaded.values()].find(({ chunk: current }) =>
    current.objectManager?.staticGraph.hasEdge(overlapIds[0], overlapIds[1]),
  )?.chunk;
  if (!chunk) throw new Error("同步基准夹具缺少层位边");
  return { ...end, targetId: `bench/${Math.floor(count / 2)}`, overlapIds };
}

/**
 * 测量同步函数单次毫秒成本
 * @param {number} records - 记录规模
 * @param {string} label - 用例名
 * @param {number} iterations - 每轮迭代数
 * @param {() => void} fn - 被测函数
 * @returns {{records: number, case: string, msPerOp: number, variationPct: number}} 测量结果
 */
function measure(records, label, iterations, fn) {
  for (let index = 0; index < Math.min(50, iterations); index += 1) fn();
  const samples = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) fn();
    samples.push((performance.now() - start) / iterations);
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  return {
    records,
    case: label,
    msPerOp: Number(mean.toFixed(4)),
    variationPct: mean > 0 ? Number(((Math.sqrt(variance) / mean) * 100).toFixed(1)) : 0,
  };
}

/**
 * 测量迟到记录落在 undo 前的树重建
 * @param {Object[]} records - 完整记录
 * @returns {Promise<{rebuilds: number, ms: number, active: number, nodes: number, undoRedo: number}>} 测量结果
 */
async function measureLateUndo(records) {
  const end = createEnd("late-reader");
  await end.api.applyRemoteOperations(records);
  const last = records.at(-1);
  const undo = createUndoOperation({
    id: `bench/op-${records.length + 1}`,
    source: "bench",
    time: last.time + 1000,
    targetNodeId: last.id,
    previousHeadId: last.id,
  });
  await end.api.applyRemoteOperations([undo]);
  const late = createAddObjectOperation({
    id: "late/op-1",
    source: "late",
    time: last.time + 500,
    parentId: last.id,
    chunkId: "1",
    objectId: "late/1",
    data: {
      id: "late/1",
      type: "StrokeObject",
      position: { x: 0, y: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    },
  });
  let rebuilds = 0;
  const rebuild = end.boardCore.undoTree.rebuild;
  end.boardCore.undoTree.rebuild = function countedRebuild() {
    rebuilds += 1;
    return rebuild.call(this);
  };
  const start = performance.now();
  await end.api.applyRemoteOperations([late]);
  const ms = performance.now() - start;
  const tree = end.api.queryUndoTree();
  const undoRedo = end.boardCore.operationLog.toJSON().filter((record) =>
    record.type === "undo" || record.type === "redo",
  ).length;
  return { rebuilds, ms, active: tree.activeChain.length, nodes: tree.nodes.length, undoRedo };
}

printHeader("同步局部自愈与链重建基准");
const rows = [];
for (const count of [1000, 10000]) {
  const fixture = await createFixture(count);
  const { api, boardCore, targetId, overlapIds } = fixture;
  const corruptState = () => {
    boardCore.getObjectById(targetId).position.x = 999;
    api.refreshMaterializedProjection({ objectIds: [targetId] });
    api.repairStateFromLog();
  };
  const corruptLayer = () => {
    const entry = [...boardCore.chunkLoaded.values()].find(({ chunk }) =>
      chunk.objectManager?.staticGraph.hasEdge(overlapIds[0], overlapIds[1]),
    );
    const graph = entry.chunk.objectManager.staticGraph;
    graph.deleteEdgeUnsafe(overlapIds[0], overlapIds[1]);
    graph.addEdgeUnsafe(overlapIds[1], overlapIds[0]);
    api.refreshMaterializedProjection({ chunkIds: [entry.chunk.id] });
    api.repairStateFromLog();
  };
  rows.push(measure(count, "单对象局部修复", 100, corruptState));
  rows.push(measure(count, "单区块层序局部修复", 100, corruptLayer));
  const queries = [
    ["logHash", () => api.queryLogHash()],
    ["chainHash", () => api.queryChainHash()],
    ["derivedStateHash", () => api.queryDerivedStateHash()],
    ["stateHash", () => api.queryStateHash()],
    ["derivedLayerHash", () => api.queryDerivedLayerHash()],
    ["layerHash", () => api.queryLayerHash()],
  ];
  for (const [label, query] of queries) {
    rows.push(measure(count, `摘要查询 ${label}`, 10000, query));
  }
  rows.push(measure(count, "repairChainFromLog", 3, () => {
    api.repairChainFromLog();
  }));
  const late = await measureLateUndo(boardCore.operationLog.toJSON());
  console.log(
    `${count} 记录：迟到 undo 前插入 -> rebuild ${late.rebuilds} 次，${late.ms.toFixed(2)}ms；` +
    `active=${late.active}，nodes=${late.nodes}，undo/redo=${late.undoRedo}`,
  );
}
console.table(rows);
printFooter();
