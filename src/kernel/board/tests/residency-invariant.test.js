/**
 * @file 对象驻留不变式测试
 * @description 验证区块被 FULL 持有时，静态图节点缺失或覆盖索引缺项都会被断言捕获。
 * @module kernel/board/tests/residency-invariant
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { BoardCore } from "../board-core.js";
import { BoardApi } from "../../api/board-api.js";
import { createDefaultAomRenderHooks } from "../aom-render-hooks.js";

describe("对象驻留不变式", () => {
  test("FULL 持有区块的节点未驻留或覆盖索引缺项时断言抛错", async () => {
    const boardCore = new BoardCore({
      width: 1024,
      height: 1024,
      aomRenderHooks: createDefaultAomRenderHooks(),
      source: "test",
    });
    const api = new BoardApi(boardCore);
    api.createObject("StrokeObject", {
      id: "test/obj-1",
      position: { x: 10, y: 10 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
    });
    await api.commitObjects(["test/obj-1"]);

    const chunkId = [...boardCore.chunkLoaded.keys()][0];
    const chunk = boardCore.getChunkById(chunkId);
    const loader = await boardCore.loadChunksAndWaitComplete(
      [chunk],
      "residency-invariant-test",
    );
    expect(() => boardCore.assertResidencyInvariant()).not.toThrow();

    boardCore.unsetObjectCoverChunks("test/obj-1");
    expect(() => boardCore.assertResidencyInvariant()).toThrow(
      "覆盖索引缺少区块",
    );

    boardCore.objectLoaded.delete("test/obj-1");
    expect(() => boardCore.assertResidencyInvariant()).toThrow("未驻留");

    loader.destroy();
  });
});
