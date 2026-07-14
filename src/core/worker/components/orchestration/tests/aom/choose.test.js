import { jest } from "@jest/globals";
import {
  chunkConnect,
  createChunk,
  createChunkAt,
  createCoverChunkStorage,
  createMockBoard,
  createObjectInChunk,
  setObjectCoverage,
  verticalChunkConnect,
} from "../../../../../test-support/aom-fixtures.js";

import { DirectedGraph } from "../../../../../utils/directed-graph.js";
import { Vector } from "../../../../../utils/math.js";
import { CircleObject } from "../../../../../shared/objects/graph/circle.js";
import { ChunkObjectManager } from "../../../chunk/chunk-object-manager.js";
import { oneChunkData } from "./data.js";

const { ActiveObjectManager } = await import("../../active-object-manager.js");

describe("ActiveObjectManager/choose", () => {
  let aom = new ActiveObjectManager();
  let chunk = createChunk(1);

  const CHUNK_SIZE = 100;

  function createObject(id, chunkId) {
    return createObjectInChunk(id, chunkId, CHUNK_SIZE);
  }

  beforeEach(() => {
    chunk = createChunk(1);
    chunk.objectManager = new ChunkObjectManager(1, createCoverChunkStorage());
    chunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);
    aom = new ActiveObjectManager(
      createMockBoard([chunk], { width: CHUNK_SIZE, height: CHUNK_SIZE }),
    );

    // 将 RandomNumberPool Mock 一下
    let idCounter = 0;
    aom.layerPool.generate = () => {
      idCounter += 1;
      return idCounter;
    };
  });

  describe("单次选择对象", () => {
    test("choose 应通过 renderHooks 触发刷新", async () => {
      const selected = createObject(12, chunk.id);
      const requestActiveRender = jest.fn();
      const requestStaticRenderForObjects = jest.fn();
      const renderHooks = {
        requestActiveRender,
        requestStaticRender: jest.fn(),
        requestStaticRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      aom = new ActiveObjectManager(undefined, { renderHooks });
      aom.layerPool.generate = () => {
        return 1;
      };

      await aom.choose(new Set([selected]));

      expect(requestActiveRender).toHaveBeenCalledWith([selected]);
      expect(requestStaticRenderForObjects).toHaveBeenCalledWith(
        [selected],
        [],
        expect.any(Map),
      );
    });

    test("应正确选择单个对象", async () => {
      await aom.choose(new Set([createObject(12, chunk.id)]));

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

    test("choose 应将 pickup 纳入 AOM 的 inactive 邻接对象一并加入静态层失效集合", async () => {
      const lower = new CircleObject(
        101,
        new Vector(50, 50),
        {},
        {
          radius: 60,
        },
      );
      const upper = new CircleObject(
        102,
        new Vector(70, 50),
        {},
        {
          radius: 60,
        },
      );

      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(
        1,
        createCoverChunkStorage(),
      );
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([
        [101, [102]],
        [102, []],
      ]);
      ownerChunk.objectManager.setObjectCoverChunks(101, [1]);
      ownerChunk.objectManager.setObjectCoverChunks(102, [1]);

      const requestStaticRenderForObjects = jest.fn();
      const renderHooks = {
        requestActiveRender: jest.fn(),
        requestStaticRender: jest.fn(),
        requestStaticRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      const objectMap = new Map([
        [101, lower],
        [102, upper],
      ]);
      const board = {
        width: CHUNK_SIZE,
        height: CHUNK_SIZE,
        getObjectById: jest.fn((objectId) => objectMap.get(objectId)),
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      aom = new ActiveObjectManager(board, { renderHooks });

      await aom.choose(new Set([lower]));

      expect(requestStaticRenderForObjects).toHaveBeenCalledTimes(1);
      const [invalidatedObjects] = requestStaticRenderForObjects.mock.calls[0];
      expect(
        invalidatedObjects
          .map((objectInstance) => objectInstance.id)
          .sort((left, right) => left - right),
      ).toEqual([101, 102]);
    });

    test("应正确选择多个对象", async () => {
      await aom.choose(
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
    test("应正确在已有选择的对象上再次选择单个对象", async () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object8 = createObject(8, chunk.id);
      const object5 = createObject(5, chunk.id);
      await aom.choose(new Set([object12, object13, object8]));

      await aom.choose(new Set([object5]));

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

    test("应正确在已有选择的对象间再次选择单个对象", async () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object5 = createObject(5, chunk.id);
      const object8 = createObject(8, chunk.id);
      await aom.choose(new Set([object12, object13, object5]));

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

      await aom.choose(new Set([object8]));

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
    test("应能基于二维覆盖区块子图正确分层", async () => {
      const centerChunk = createChunkAt(0, 0);
      const rightChunk = createChunkAt(1, 0);
      const upChunk = createChunkAt(0, 1);
      const rightUpChunk = createChunkAt(1, 1);
      aom = new ActiveObjectManager(
        createMockBoard([centerChunk, rightChunk, upChunk, rightUpChunk], {
          width: CHUNK_SIZE,
          height: CHUNK_SIZE,
        }),
      );

      centerChunk.objectManager = new ChunkObjectManager(
        centerChunk.id,
        createCoverChunkStorage(),
      );
      rightChunk.objectManager = new ChunkObjectManager(
        rightChunk.id,
        createCoverChunkStorage(),
      );
      upChunk.objectManager = new ChunkObjectManager(
        upChunk.id,
        createCoverChunkStorage(),
      );
      rightUpChunk.objectManager = new ChunkObjectManager(
        rightUpChunk.id,
        createCoverChunkStorage(),
      );

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

      await aom.choose(new Set([createObject(100, centerChunk.id)]));

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
