// SPDX-License-Identifier: MIT

import { BoardCore } from "../../board/board-core.js";
import { BoardApi } from "../../api/board-api.js";
import { DerivedBoardProjection } from "../derived-board-projection.js";
import { createAddObjectOperation, createDeleteObjectOperation, createModifyObjectOperation } from "../../hit/operation.js";

/**
 * 创建带公共 API 的白板端
 * @returns {{boardCore: BoardCore, api: BoardApi}} 白板端
 */
function createEnd() {
  const boardCore = new BoardCore({ source: "a", width: 800, height: 600 });
  return { boardCore, api: new BoardApi(boardCore) };
}

/**
 * 创建并提交静态笔画
 * @param {BoardApi} api - 内核 API
 * @param {string} id - 对象 id
 * @returns {Promise<void>}
 */
async function createStroke(api, id) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 100, y: 100 },
    property: { width: 2 },
    data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
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
 * 计算活动链过渡
 * @param {Object[]} before - 旧记录
 * @param {Object[]} after - 新记录
 * @returns {{diverge: number, removed: Object[], added: Object[]}} 过渡
 */
function transitionOf(before, after) {
  let diverge = 0;
  while (diverge < before.length && diverge < after.length && before[diverge].id === after[diverge].id) {
    diverge += 1;
  }
  return { diverge, removed: before.slice(diverge), added: after.slice(diverge) };
}

describe("DerivedBoardProjection 对象与 trash", () => {
  test("修改、删除和撤销与实际对象状态一致", async () => {
    const { boardCore, api } = createEnd();
    await createStroke(api, "a/1");
    await createStroke(api, "a/2");
    await api.addActiveObjects(["a/2"]);
    api.modifyObject("a/2", { position: { x: 200, y: 100 } });
    await api.commitObjects(["a/2"]);
    api.deleteObjects(["a/1"]);

    const projection = new DerivedBoardProjection();
    projection.rebuild(activeRecords(boardCore));
    expect(projection.getObject("a/1").location).toBe("trash");
    expect(projection.getObject("a/2").data.position.x).toBe(200);

    const before = activeRecords(boardCore);
    api.undo();
    projection.applyTransition(transitionOf(before, activeRecords(boardCore)));
    expect(projection.getObject("a/1").location).toBe("objects");
    expect(projection.getObject("a/1").data.id).toBe("a/1");

    const rebuilt = new DerivedBoardProjection();
    rebuilt.rebuild(activeRecords(boardCore));
    expect(projection.stateHash).toBe(rebuilt.stateHash);
  });

  test("discard restore 只凭活动记录即可还原", async () => {
    const { boardCore, api } = createEnd();
    await createStroke(api, "a/1");
    await api.addActiveObjects(["a/1"]);
    api.modifyObject("a/1", { position: { x: 999, y: 100 } });
    api.discardActiveObjects(["a/1"]);
    const projection = new DerivedBoardProjection();
    projection.rebuild(activeRecords(boardCore));

    expect(projection.getObject("a/1").data.position.x).toBe(100);
    expect(api.queryObject("a/1").position.x).toBe(100);
  });

  test("trash 中修改与逆放不创建活体", () => {
    const data = {
      id: "a/1",
      type: "StrokeObject",
      position: { x: 0, y: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1 },
      property: {},
      data: { points: [] },
    };
    const add = createAddObjectOperation({ id: "a/op-1", source: "a", time: 1, chunkId: "1", objectId: "a/1", data });
    const del = createDeleteObjectOperation({ id: "a/op-2", source: "a", time: 2, chunkId: "1", objectId: "a/1", data, chunks: [] });
    const after = { ...data, position: { x: 8, y: 0 } };
    const modify = createModifyObjectOperation({
      id: "a/op-3", source: "a", time: 3, chunkId: "1", objectId: "a/1",
      properties: ["position"], before: data, after,
    });
    const projection = new DerivedBoardProjection();
    projection.rebuild([add, del, modify]);
    expect(projection.getObject("a/1").data.position.x).toBe(8);
    expect(projection.getObject("a/1").location).toBe("trash");

    projection.applyTransition({ removed: [modify], added: [] });
    expect(projection.getObject("a/1").data.position.x).toBe(0);
    expect(projection.getObject("a/1").location).toBe("trash");
  });
});
