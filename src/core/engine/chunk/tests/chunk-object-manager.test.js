import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import { DirectedGraph } from "../../utils/directed-graph.js";
import { Vector } from "../../utils/math.js";
import { handleCoreFileOperateRequest } from "../../../bridges/file-operate-bridge-main.js";
import { CORE_FILE_OPERATE_ACTIONS } from "../../../bridges/file-operate-bridge-common.js";
import { boardFileOperateBridge } from "../../../bridges/file-operate-bridge-renderer.js";
import { ChunkObjectManager } from "../chunk-object-manager.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";

/**
 * 创建覆盖区块索引存储
 * @returns {{
 *   setObjectCoverChunks: (objectId: number, chunkIds: Iterable<number>) => void,
 *   getObjectCoverChunks: (objectId: number) => Set<number> | undefined,
 *   unsetObjectCoverChunks: (objectId: number) => void,
 * }}
 */
function createCoverChunkStorage() {
  const coverChunks = new Map();
  return {
    setObjectCoverChunks(objectId, chunkIds) {
      coverChunks.set(objectId, new Set(chunkIds));
    },
    getObjectCoverChunks(objectId) {
      return coverChunks.get(objectId);
    },
    unsetObjectCoverChunks(objectId) {
      coverChunks.delete(objectId);
    },
  };
}

describe("ChunkObjectManager", () => {
  let tempRoot;
  let originalBridge;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "hound-chunk-object-manager-"),
    );
    originalBridge = globalThis.__houndCoreFileOps;
    globalThis.__houndCoreFileOps = {
      call: async ({ action, payload }) =>
        handleCoreFileOperateRequest(null, { action, payload }),
    };
  });

  afterEach(() => {
    if (originalBridge === undefined) {
      delete globalThis.__houndCoreFileOps;
    } else {
      globalThis.__houndCoreFileOps = originalBridge;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("应随层叠图一起持久化对象覆盖区块索引", async () => {
    const boardRoot = path.join(tempRoot, "board");
    handleCoreFileOperateRequest(null, {
      action: CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT,
      payload: {
        rootPath: boardRoot,
        boardMeta: { type: "board", version: "0.1.0" },
        config: { width: 800, height: 600 },
      },
    });

    const coverChunkBoard = createCoverChunkStorage();
    const chunkObjectManager = new ChunkObjectManager(1, coverChunkBoard);
    chunkObjectManager.staticGraph = DirectedGraph.parse([
      [15, [18]],
      [18, []],
    ]);
    chunkObjectManager.setObjectCoverChunks(15, [1, 2]);
    chunkObjectManager.setObjectCoverChunks(18, [1, 2, 3]);

    await chunkObjectManager.saveChunkMetadata(boardRoot);

    const restoredManager = new ChunkObjectManager(1, coverChunkBoard);
    await restoredManager.loadChunkMetadata(boardRoot);

    // 层叠图由 COM 持久化，新实例从磁盘恢复后应一致
    expect(
      restoredManager.staticGraph.equals(chunkObjectManager.staticGraph),
    ).toBe(true);
    // 覆盖索引通过 board 存储，COM 序列化时不包含（有 board 时返回 []）
    expect(coverChunkBoard.getObjectCoverChunks(15)).toEqual(new Set([1, 2]));
    expect(coverChunkBoard.getObjectCoverChunks(18)).toEqual(
      new Set([1, 2, 3]),
    );
  });

  test("无 rootPath 时层叠图读写应直接保持内存 no-op", async () => {
    const coverChunkBoard = createCoverChunkStorage();
    const chunkObjectManager = new ChunkObjectManager(1, coverChunkBoard);
    chunkObjectManager.staticGraph = DirectedGraph.parse([
      [15, [18]],
      [18, []],
    ]);
    chunkObjectManager.setObjectCoverChunks(15, [1, 2]);

    const loadMetadataSpy = jest.spyOn(
      boardFileOperateBridge,
      "loadChunkMetadata",
    );
    const saveMetadataSpy = jest.spyOn(
      boardFileOperateBridge,
      "saveChunkMetadata",
    );

    await chunkObjectManager.loadChunkMetadata();
    await chunkObjectManager.saveChunkMetadata();

    expect(loadMetadataSpy).not.toHaveBeenCalled();
    expect(saveMetadataSpy).not.toHaveBeenCalled();
    expect(
      chunkObjectManager.staticGraph.equals(
        DirectedGraph.parse([
          [15, [18]],
          [18, []],
        ]),
      ),
    ).toBe(true);
    // 覆盖索引通过 board 存储
    expect(coverChunkBoard.getObjectCoverChunks(15)).toEqual(new Set([1, 2]));

    loadMetadataSpy.mockRestore();
    saveMetadataSpy.mockRestore();
  });

  test("应基于对象 range 精确计算覆盖区块，而不是仅按 bounding box 粗算", () => {
    const coverChunkBoard = createCoverChunkStorage();
    const chunkObjectManager = new ChunkObjectManager(1, coverChunkBoard);
    const stroke = new StrokeObject(15, new Vector(0, 0));
    stroke.setData({
      points: [new Vector(1, 1), new Vector(19, 1), new Vector(19, 19)].map(
        (p) => ({ x: p.x, y: p.y }),
      ),
    });

    const coveredChunks = chunkObjectManager.syncObjectCoverChunksForObject(
      stroke,
      10,
      10,
    );

    expect(
      Array.from(coveredChunks).sort((left, right) => left - right),
    ).toEqual([1, 2, 3]);

    expect(chunkObjectManager.getObjectCoverChunks(15)).toEqual(
      new Set([1, 2, 3]),
    );

    expect(chunkObjectManager.getObjectCoverChunks(15).has(4)).toBe(false);
  });
});
