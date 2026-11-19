// SPDX-License-Identifier: MIT

import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import { DirectedGraph } from "../../utils/directed-graph.js";
import { Vector } from "../../utils/math.js";
import { createNodeDriver } from "../../../io/driver/node.js";
import { createPersistenceAdapter } from "../../../io/adapter/persistence.js";
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

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "hound-chunk-object-manager-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("应随层叠图一起持久化对象覆盖区块索引", async () => {
    const boardRoot = path.join(tempRoot, "board");
    const driver = createNodeDriver(boardRoot);
    await driver.registerRoot(boardRoot);
    const adapter = createPersistenceAdapter({ driver, rootId: "local" });

    const ingestedTypes = [];
    const coverChunkBoard = {
      ...createCoverChunkStorage(),
      persistenceAdapter: adapter,
      memoryMode: () => false,
      getObjectType: (objectId) => (objectId === 15 ? "StrokeObject" : null),
      ingestObjectTypes: (entries) => ingestedTypes.push(...(entries ?? [])),
    };
    const chunkObjectManager = new ChunkObjectManager(1, coverChunkBoard);
    chunkObjectManager.staticGraph = DirectedGraph.parse([
      [15, [18]],
      [18, []],
    ]);
    chunkObjectManager.setObjectCoverChunks(15, [1, 2]);
    chunkObjectManager.setObjectCoverChunks(18, [1, 2, 3]);

    await chunkObjectManager.saveChunkMetadata();

    const rawMetadata = JSON.parse(
      fs.readFileSync(path.join(boardRoot, "chunks", "1.json"), "utf8"),
    );
    expect(rawMetadata.objectTypes).toEqual([["15", "StrokeObject"]]);

    const restoredManager = new ChunkObjectManager(1, coverChunkBoard);
    await restoredManager.loadChunkMetadata();

    // 层叠图由 COM 持久化，新实例从磁盘恢复后应一致
    expect(
      restoredManager.staticGraph.equals(chunkObjectManager.staticGraph),
    ).toBe(true);
    // 类型在加载时并入 BoardCore 的类型索引
    expect(ingestedTypes).toEqual([["15", "StrokeObject"]]);
    // 覆盖索引通过 board 存储，COM 序列化时不包含（有 board 时返回 []）
    expect(coverChunkBoard.getObjectCoverChunks(15)).toEqual(new Set([1, 2]));
    expect(coverChunkBoard.getObjectCoverChunks(18)).toEqual(
      new Set([1, 2, 3]),
    );
  });

  test("内存模式下层叠图读写保持 no-op", async () => {
    const coverChunkBoard = {
      ...createCoverChunkStorage(),
      persistenceAdapter: createPersistenceAdapter({
        driver: createNodeDriver(tempRoot),
        rootId: "local",
      }),
      memoryMode: () => true,
    };
    const chunkObjectManager = new ChunkObjectManager(1, coverChunkBoard);
    chunkObjectManager.staticGraph = DirectedGraph.parse([
      [15, [18]],
      [18, []],
    ]);
    chunkObjectManager.setObjectCoverChunks(15, [1, 2]);

    const loadMetadataSpy = jest.spyOn(
      coverChunkBoard.persistenceAdapter,
      "loadChunkMetadata",
    );
    const saveMetadataSpy = jest.spyOn(
      coverChunkBoard.persistenceAdapter,
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
