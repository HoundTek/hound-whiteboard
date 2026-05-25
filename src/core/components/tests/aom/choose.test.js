import { jest } from "@jest/globals";
import { MockChunkBlockLoader } from "./chunk-block-loader.mock.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Chunk } from "../../chunk.js";
import { ChunkObjectManager } from "../../chunk-object-manager.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { Vector } from "../../../utils/math.js";
import { oneChunkData } from "./data.js";

jest.unstable_mockModule("../../chunk-block-loader.js", () => ({
  ChunkBlockLoader: MockChunkBlockLoader,
}));

const { ActiveObjectManager } = await import("../../active-object-manager.js");

describe("ActiveObjectManager/choose", () => {
  let aom = new ActiveObjectManager();
  let chunk = createChunk(1);

  function createChunk(id) {
    const chunk = Chunk.fromId(id);
    chunk.isLoad = true;
    chunk.isTempLoad = false;
    return chunk;
  }

  function createChunkAt(x, y) {
    const chunk = Chunk.fromCoordinate(x, y);
    chunk.isLoad = true;
    chunk.isTempLoad = false;
    return chunk;
  }

  function createObject(id, chunkId) {
    return new BasicObject(new Vector(0, 0), id, chunkId);
  }

  function createBoard(...chunks) {
    const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    return {
      createChunkBlockLoader: () => new MockChunkBlockLoader(),
      getChunkById: (chunkId) => chunkMap.get(chunkId),
    };
  }

  function chunkConnect(chunkA, chunkB) {
    chunkA.rightChunk = chunkB;
    chunkB.leftChunk = chunkA;
  }

  function verticalChunkConnect(lowerChunk, upperChunk) {
    lowerChunk.upChunk = upperChunk;
    upperChunk.downChunk = lowerChunk;
  }

  function setObjectCoverage(chunks, objectIds) {
    const chunkIds = chunks.map((item) => item.id);

    for (const targetChunk of chunks) {
      for (const objectId of objectIds) {
        targetChunk.objectManager.setObjectCoverChunks(objectId, chunkIds);
      }
    }
  }

  beforeEach(() => {
    chunk = createChunk(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);
    aom = new ActiveObjectManager(createBoard(chunk));

    // 将 RandomNumberPool Mock 一下
    let idCounter = 0;
    aom.layerPool.generate = () => {
      idCounter += 1;
      return idCounter;
    };
  });

  describe("单次选择对象", () => {
    test("choose 应触发 monitor.liveRenderer.invalidateObjects", () => {
      const selected = createObject(12, chunk.id);
      const monitor = {
        liveRenderer: {
          collectActiveDrawables: jest.fn(() => []),
          invalidateObjects: jest.fn(),
        },
        renderScheduler: { invalidate: jest.fn() },
      };
      const board = createBoard(chunk);
      board.monitors = new Map([["main", monitor]]);
      aom = new ActiveObjectManager(board);

      aom.choose(new Set([selected]));

      expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledWith([
        selected,
      ]);
    });

    test("应正确选择单个对象", () => {
      aom.choose(new Set([createObject(12, chunk.id)]));

      const expectedActiveSet = new Set([12]);
      const expectedInactiveGraph = DirectedGraph.parse([
        [7, [4]],
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);

      expect(aom.layerOrder.length).toBe(1);
      expect(aom.layerOrder[0].activeObjects).toEqual(expectedActiveSet);
      expect(
        aom.layerOrder[0].inactiveGraph.equals(expectedInactiveGraph),
      ).toBe(true);
    });

    test("应正确选择多个对象", () => {
      aom.choose(
        new Set([
          createObject(12, chunk.id),
          createObject(13, chunk.id),
          createObject(8, chunk.id),
        ]),
      );

      const expectedActiveSet = [new Set([12, 13]), new Set([8])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, []],
          [9, [6]],
          [6, []],
        ]),
        DirectedGraph.parse([
          [5, [2, 3]],
          [4, [2]],
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(2);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });
  });

  describe("多次选择对象", () => {
    test("应正确在已有选择的对象上再次选择单个对象", () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object8 = createObject(8, chunk.id);
      const object5 = createObject(5, chunk.id);
      aom.choose(new Set([object12, object13, object8]));

      aom.choose(new Set([object5]));

      const expectedActiveSet = [new Set([12, 13]), new Set([8]), new Set([5])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, []],
          [9, [6]],
          [6, []],
        ]),
        DirectedGraph.parse([[4, []]]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(3);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应正确在已有选择的对象间再次选择单个对象", () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object5 = createObject(5, chunk.id);
      const object8 = createObject(8, chunk.id);
      aom.choose(new Set([object12, object13, object5]));

      const expectedActiveSet1 = [new Set([12, 13]), new Set([5])];
      const expectedInactiveGraph1 = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [6, []],
          [4, []],
        ]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(2);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet1[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph1[i]),
        ).toBe(true);
      }

      aom.choose(new Set([object8]));

      const expectedActiveSet = [new Set([12, 13]), new Set([8]), new Set([5])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, []],
          [9, [6]],
          [6, []],
        ]),
        DirectedGraph.parse([[4, []]]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(3);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });
  });

  describe("二维跨区块选择对象", () => {
    test("应能基于二维覆盖区块子图正确分层", () => {
      const centerChunk = createChunkAt(0, 0);
      const rightChunk = createChunkAt(1, 0);
      const upChunk = createChunkAt(0, 1);
      const rightUpChunk = createChunkAt(1, 1);
      aom = new ActiveObjectManager(
        createBoard(centerChunk, rightChunk, upChunk, rightUpChunk),
      );

      centerChunk.objectManager = new ChunkObjectManager(centerChunk.id);
      rightChunk.objectManager = new ChunkObjectManager(rightChunk.id);
      upChunk.objectManager = new ChunkObjectManager(upChunk.id);
      rightUpChunk.objectManager = new ChunkObjectManager(rightUpChunk.id);

      centerChunk.objectManager.staticGraph = DirectedGraph.parse([
        [100, [101]],
        [101, []],
      ]);
      rightChunk.objectManager.staticGraph = DirectedGraph.parse([]);
      upChunk.objectManager.staticGraph = DirectedGraph.parse([
        [100, [102]],
        [102, [104]],
        [104, []],
      ]);
      rightUpChunk.objectManager.staticGraph = DirectedGraph.parse([
        [100, [103]],
        [103, []],
      ]);

      setObjectCoverage([centerChunk, upChunk, rightUpChunk], [100]);

      chunkConnect(centerChunk, rightChunk);
      verticalChunkConnect(centerChunk, upChunk);
      verticalChunkConnect(rightChunk, rightUpChunk);

      aom.choose(new Set([createObject(100, centerChunk.id)]));

      expect(aom.layerOrder.length).toBe(1);
      expect(aom.layerOrder[0].activeObjects).toEqual(new Set([100]));
      expect(
        aom.layerOrder[0].inactiveGraph.equals(
          DirectedGraph.parse([
            [101, []],
            [102, [104]],
            [103, []],
            [104, []],
          ]),
        ),
      ).toBe(true);
    });
  });
});
