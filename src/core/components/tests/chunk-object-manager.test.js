import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import { DirectedGraph } from "../../utils/directed-graph.js";
import { Vector } from "../../utils/math.js";
import { handleCoreFileOperateRequest } from "../../bridges/file-operate-bridge-main.js";
import { CORE_FILE_OPERATE_ACTIONS } from "../../bridges/file-operate-bridge-common.js";
import { boardFileOperateBridge } from "../../bridges/file-operate-bridge-renderer.js";
import { ChunkObjectManager } from "../chunk-object-manager.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";

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

    const chunkObjectManager = new ChunkObjectManager(1);
    chunkObjectManager.staticGraph = DirectedGraph.parse([
      [15, [18]],
      [18, []],
    ]);
    chunkObjectManager.setObjectCoverChunks(15, [1, 2]);
    chunkObjectManager.setObjectCoverChunks(18, [1, 2, 3]);

    await chunkObjectManager.saveTierGraph(boardRoot);

    const restoredManager = new ChunkObjectManager(1);
    await restoredManager.loadTierGraph(boardRoot);

    expect(
      restoredManager.staticGraph.equals(chunkObjectManager.staticGraph),
    ).toBe(true);
    expect(restoredManager.serializeObjectCoverChunks()).toEqual([
      [15, [1, 2]],
      [18, [1, 2, 3]],
    ]);
  });

  test("无 rootPath 时层叠图读写应直接保持内存 no-op", async () => {
    const chunkObjectManager = new ChunkObjectManager(1);
    chunkObjectManager.staticGraph = DirectedGraph.parse([
      [15, [18]],
      [18, []],
    ]);
    chunkObjectManager.setObjectCoverChunks(15, [1, 2]);

    const loadTierGraphSpy = jest.spyOn(
      boardFileOperateBridge,
      "loadTierGraph",
    );
    const loadCoverIndexSpy = jest.spyOn(
      boardFileOperateBridge,
      "loadChunkObjectCoverIndex",
    );
    const saveTierGraphSpy = jest.spyOn(
      boardFileOperateBridge,
      "saveTierGraph",
    );
    const saveCoverIndexSpy = jest.spyOn(
      boardFileOperateBridge,
      "saveChunkObjectCoverIndex",
    );

    await chunkObjectManager.loadTierGraph();
    await chunkObjectManager.saveTierGraph();

    expect(loadTierGraphSpy).not.toHaveBeenCalled();
    expect(loadCoverIndexSpy).not.toHaveBeenCalled();
    expect(saveTierGraphSpy).not.toHaveBeenCalled();
    expect(saveCoverIndexSpy).not.toHaveBeenCalled();
    expect(
      chunkObjectManager.staticGraph.equals(
        DirectedGraph.parse([
          [15, [18]],
          [18, []],
        ]),
      ),
    ).toBe(true);
    expect(chunkObjectManager.serializeObjectCoverChunks()).toEqual([
      [15, [1, 2]],
    ]);

    loadTierGraphSpy.mockRestore();
    loadCoverIndexSpy.mockRestore();
    saveTierGraphSpy.mockRestore();
    saveCoverIndexSpy.mockRestore();
  });

  test("应基于对象 range 精确计算覆盖区块，而不是仅按 bounding box 粗算", () => {
    const chunkObjectManager = new ChunkObjectManager(1);
    const stroke = new StrokeObject(new Vector(0, 0), 15, 1);
    stroke.setPathPoints([
      new Vector(1, 1),
      new Vector(19, 1),
      new Vector(19, 19),
    ]);

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
