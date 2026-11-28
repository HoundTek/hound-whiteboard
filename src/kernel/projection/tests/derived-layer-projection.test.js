// SPDX-License-Identifier: MIT

import { BoardCore } from "../../board/board-core.js";
import { BoardApi } from "../../api/board-api.js";
import { DerivedBoardProjection } from "../derived-board-projection.js";

/**
 * 创建白板端
 * @param {string} source - 来源
 * @returns {{boardCore: BoardCore, api: BoardApi}} 白板端
 */
function createEnd(source) {
  const boardCore = new BoardCore({ source, width: 800, height: 600 });
  return { boardCore, api: new BoardApi(boardCore) };
}

/**
 * 创建并提交重叠笔画
 * @param {BoardApi} api - 内核 API
 * @param {string} id - 对象 id
 * @returns {Promise<void>}
 */
async function createStroke(api, id) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 100, y: 100 },
    property: { width: 2 },
    data: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
  });
  await api.commitObjects([id]);
}

/**
 * 导出活动记录
 * @param {BoardCore} boardCore - 白板核心
 * @returns {Object[]} 活动记录
 */
function activeRecords(boardCore) {
  return boardCore.undoTree.getActiveChain().flatMap((node) =>
    node.memberIds.map((id) => boardCore.operationLog.get(id)).filter(Boolean),
  );
}

/**
 * 归一化各区块静态图
 * @param {BoardCore|DerivedBoardProjection} source - 图来源
 * @returns {Object} 图签名
 */
function graphSignatures(source) {
  const graphs = source instanceof DerivedBoardProjection
    ? source.getGraphEntries()
    : [...source.chunkLoaded.values()].map(({ chunk }) => [chunk.id, chunk.objectManager?.staticGraph]);
  return Object.fromEntries(graphs.filter(([, graph]) => graph?.getNodes().length > 0).map(([chunkId, graph]) => [
    chunkId,
    [...graph.getNodes()].sort().map((id) => [id, [...graph.neighborsUnsafe(id)].sort()]),
  ]));
}

describe("DerivedBoardProjection 层序", () => {
  test("记录边、修改、撤销和跨区块移动与全量远端应用一致", async () => {
    const a = createEnd("a");
    const b = createEnd("b");
    await createStroke(a.api, "x");
    await createStroke(a.api, "y");
    await b.api.applyRemoteOperations(a.boardCore.operationLog.toJSON());

    const projection = new DerivedBoardProjection({ width: 800, height: 600 });
    projection.rebuild(activeRecords(a.boardCore));
    expect(graphSignatures(projection)).toEqual(graphSignatures(b.boardCore));

    const deltaStart = a.boardCore.operationLog.size;
    await a.api.addActiveObjects(["x"]);
    apiMove(a.api, "x", 1000);
    await a.api.commitObjects(["x"]);
    const delta = a.boardCore.operationLog.toJSON().slice(deltaStart);
    await b.api.applyRemoteOperations(delta);
    projection.rebuild(activeRecords(a.boardCore));
    expect(graphSignatures(projection)).toEqual(graphSignatures(b.boardCore));

    const before = activeRecords(a.boardCore);
    const undoStart = a.boardCore.operationLog.size;
    a.api.undo();
    await b.api.applyRemoteOperations(a.boardCore.operationLog.toJSON().slice(undoStart));
    const after = activeRecords(a.boardCore);
    let diverge = 0;
    while (before[diverge]?.id === after[diverge]?.id) diverge += 1;
    projection.applyTransition({ removed: before.slice(diverge), added: after.slice(diverge) });
    expect(graphSignatures(projection)).toEqual(graphSignatures(b.boardCore));
  });
});

/**
 * 修改单个对象位置
 * @param {BoardApi} api - 内核 API
 * @param {string} id - 对象 id
 * @param {number} x - 新横坐标
 * @returns {void}
 */
function apiMove(api, id, x) {
  api.modifyObject(id, { position: { x, y: 100 } });
}
