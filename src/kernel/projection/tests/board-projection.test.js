// SPDX-License-Identifier: MIT

import { BoardCore } from "../../board/board-core.js";
import { BoardApi } from "../../api/board-api.js";

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

describe("BoardProjection 物化捕获", () => {
  test("本地提交与远端应用都捕获最终对象和静态图", async () => {
    const a = createEnd("a");
    const b = createEnd("b");
    await createStroke(a.api, "a/1");
    await a.api.flushProjection();
    await b.api.applyRemoteOperations(a.boardCore.operationLog.toJSON());
    await b.api.flushProjection();

    for (const end of [a, b]) {
      expect(end.api.queryStateHash()).toBe(end.api.queryDerivedStateHash());
      expect(end.api.queryLayerHash()).toBe(end.api.queryDerivedLayerHash());
      expect(end.boardCore.getObjectById("a/1").position.x).toBe(100);
    }

    await a.api.addActiveObjects(["a/1"]);
    a.api.modifyObject("a/1", { position: { x: 200, y: 100 } });
    await a.api.commitObjects(["a/1"]);
    const delta = a.boardCore.operationLog.toJSON().slice(1);
    await b.api.applyRemoteOperations(delta);
    await Promise.all([a.api.flushProjection(), b.api.flushProjection()]);

    expect(a.api.queryStateHash()).toBe(b.api.queryStateHash());
    expect(a.api.queryLayerHash()).toBe(b.api.queryLayerHash());
    expect(b.boardCore.getObjectById("a/1").position.x).toBe(200);
  });
});
