import { jest } from "@jest/globals";
import { createChunk, createChunkAt } from "../../../test-support/aom-fixtures.js";
import { MockChunkBlockLoader } from "./chunk-block-loader.mock.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Chunk } from "../../chunk.js";
import { ChunkObjectManager } from "../../chunk-object-manager.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { Vector } from "../../../utils/math.js";
import { oneChunkData, twoChunkData, multiChunkData } from "./data.js";

jest.unstable_mockModule("../../chunk-block-loader.js", () => ({
  ChunkBlockLoader: MockChunkBlockLoader,
}));

const { ActiveObjectManager } = await import("../../active-object-manager.js");

describe("ActiveObjectManager/pickup", () => {
  let aom = new ActiveObjectManager();

  beforeEach(() => {
    aom = new ActiveObjectManager();
  });

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
    const chunkIds = chunks.map((chunk) => chunk.id);

    for (const chunk of chunks) {
      for (const objectId of objectIds) {
        chunk.objectManager.setObjectCoverChunks(objectId, chunkIds);
      }
    }
  }

  describe("选取无跨区块对象的子图", () => {
    let chunk = createChunk(1);

    beforeEach(() => {
      chunk = createChunk(1);
      chunk.objectManager = new ChunkObjectManager(1);
      chunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);
      aom = new ActiveObjectManager(createBoard(chunk));
    });

    test("应能选取单对象为起点且无跨区块对象的子图", () => {
      const pickup8 = aom.pickup(new Set([createObject(8, chunk.id)]));

      const expected8 = DirectedGraph.parse([
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);

      expect(pickup8.equals(expected8)).toBe(true);

      const pickup11 = aom.pickup(new Set([createObject(11, chunk.id)]));

      const expected11 = DirectedGraph.parse([
        [11, [7]],
        [7, [4]],
        [4, [2]],
        [2, [1]],
        [1, []],
      ]);

      expect(pickup11.equals(expected11)).toBe(true);
    });

    test("应能选取多对象为起点且无跨区块对象的子图", () => {
      const pickup8n15 = aom.pickup(
        new Set([
          createObject(8, chunk.id),
          createObject(15, chunk.id),
        ]),
      );

      const expected8n15 = DirectedGraph.parse([
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
        [15, [10]],
        [10, [6]],
        [6, [3]],
        [3, [1]],
      ]);

      expect(pickup8n15.equals(expected8n15)).toBe(true);
    });
  });

  describe("选取含跨区块对象的子图", () => {
    let chunk1 = createChunk(1);
    let chunk2 = createChunk(2);

    beforeEach(() => {
      chunk1 = createChunk(1);
      chunk2 = createChunk(2);
      aom = new ActiveObjectManager(createBoard(chunk1, chunk2));

      chunkConnect(chunk1, chunk2);

      chunk1.objectManager = new ChunkObjectManager(1);
      chunk2.objectManager = new ChunkObjectManager(2);

      chunk1.objectManager.staticGraph = DirectedGraph.parse(twoChunkData[0]);
      chunk2.objectManager.staticGraph = DirectedGraph.parse(twoChunkData[1]);

      setObjectCoverage([chunk1, chunk2], [15, 17, 18]);
    });

    test("应能选取单对象为起点且含跨区块对象的子图", () => {
      const pickup18 = aom.pickup(new Set([createObject(18, chunk2.id)]));

      const expected18 = DirectedGraph.parse([
        [18, [6]],
        [6, [3]],
        [3, [1]],
        [1, []],
      ]);

      expect(pickup18.equals(expected18)).toBe(true);

      const pickup15 = aom.pickup(new Set([createObject(15, chunk1.id)]));

      const expected15 = DirectedGraph.parse([
        [15, [10, 16]],
        [16, [17]],
        [17, [18]],
        [18, [6]],
        [10, [6, 17]],
        [6, [3]],
        [3, [1]],
        [1, []],
      ]);

      expect(pickup15.equals(expected15)).toBe(true);
    });

    test("应能选取多对象为起点且含跨区块对象的子图", () => {
      const pickup8n10 = aom.pickup(
        new Set([
          createObject(8, chunk1.id),
          createObject(10, chunk1.id),
        ]),
      );

      const expected8n10 = DirectedGraph.parse([
        [8, [4, 5]],
        [10, [6, 17]],
        [17, [18]],
        [18, [6]],
        [6, [3]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);

      expect(pickup8n10.equals(expected8n10)).toBe(true);
    });
  });

  describe("选取含多区块的跨区块对象链的子图", () => {
    let chunk1 = createChunkAt(0, 0);
    let chunk2 = createChunkAt(1, 0);
    let chunk3 = createChunkAt(2, 0);
    let chunk4 = createChunkAt(3, 0);
    let chunk5 = createChunkAt(4, 0);

    beforeEach(() => {
      chunk1 = createChunkAt(0, 0);
      chunk2 = createChunkAt(1, 0);
      chunk3 = createChunkAt(2, 0);
      chunk4 = createChunkAt(3, 0);
      chunk5 = createChunkAt(4, 0);
      aom = new ActiveObjectManager(createBoard(chunk1, chunk2, chunk3, chunk4, chunk5));

      chunk1.objectManager = new ChunkObjectManager(chunk1.id);
      chunk2.objectManager = new ChunkObjectManager(chunk2.id);
      chunk3.objectManager = new ChunkObjectManager(chunk3.id);
      chunk4.objectManager = new ChunkObjectManager(chunk4.id);
      chunk5.objectManager = new ChunkObjectManager(chunk5.id);

      chunk1.objectManager.staticGraph = DirectedGraph.parse(multiChunkData[0]);
      chunk2.objectManager.staticGraph = DirectedGraph.parse(multiChunkData[1]);
      chunk3.objectManager.staticGraph = DirectedGraph.parse(multiChunkData[2]);
      chunk4.objectManager.staticGraph = DirectedGraph.parse(multiChunkData[3]);
      chunk5.objectManager.staticGraph = DirectedGraph.parse(multiChunkData[4]);

      setObjectCoverage([chunk1, chunk2], [3, 18]);
      setObjectCoverage([chunk2, chunk3], [5, 16]);
      setObjectCoverage([chunk3, chunk4], [7, 14]);
      setObjectCoverage([chunk4, chunk5], [9, 12]);

      chunkConnect(chunk1, chunk2);
      chunkConnect(chunk2, chunk3);
      chunkConnect(chunk3, chunk4);
      chunkConnect(chunk4, chunk5);
    });

    test("应能选取多对象为起点且含多区块跨区块对象链的子图", () => {
      const pickup6n19 = aom.pickup(
        new Set([
          createObject(6, chunk3.id),
          createObject(19, chunk1.id),
        ]),
      );

      const expected6n19 = DirectedGraph.parse([
        [6, [7]],
        [7, [8]],
        [8, [9]],
        [9, [10]],
        [10, [11]],
        [11, [12]],
        [12, [13]],
        [13, [14]],
        [14, [15]],
        [15, [16]],
        [16, [17]],
        [17, [18]],
        [18, [19]],
        [19, [20]],
        [20, []],
      ]);

      expect(pickup6n19.equals(expected6n19)).toBe(true);
    });
  });

  describe("特殊情况与边界条件", () => {
    test("应能在二维区块中先横向后纵向移动，并在回到原区块后继续遍历其它覆盖区块", () => {
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
        [100, [103]],
        [103, []],
      ]);
      rightUpChunk.objectManager.staticGraph = DirectedGraph.parse([
        [100, [104]],
        [104, []],
      ]);

      setObjectCoverage([centerChunk, upChunk, rightUpChunk], [100]);

      chunkConnect(centerChunk, rightChunk);
      verticalChunkConnect(centerChunk, upChunk);
      verticalChunkConnect(rightChunk, rightUpChunk);

      const pickup = aom.pickup(new Set([createObject(100, centerChunk.id)]));
      const expected = DirectedGraph.parse([
        [100, [101, 103, 104]],
        [101, []],
        [103, []],
        [104, []],
      ]);

      expect(pickup.equals(expected)).toBe(true);
    });

    test("应能在二维区块中向左下方向移动到覆盖区块", () => {
      const centerChunk = createChunkAt(0, 0);
      const upperChunk = createChunkAt(0, 1);
      const startChunk = createChunkAt(1, 1);
      aom = new ActiveObjectManager(createBoard(centerChunk, upperChunk, startChunk));

      centerChunk.objectManager = new ChunkObjectManager(centerChunk.id);
      upperChunk.objectManager = new ChunkObjectManager(upperChunk.id);
      startChunk.objectManager = new ChunkObjectManager(startChunk.id);

      centerChunk.objectManager.staticGraph = DirectedGraph.parse([
        [200, [201]],
        [201, []],
      ]);
      upperChunk.objectManager.staticGraph = DirectedGraph.parse([]);
      startChunk.objectManager.staticGraph = DirectedGraph.parse([
        [200, [202]],
        [202, []],
      ]);

      setObjectCoverage([startChunk, centerChunk], [200]);

      chunkConnect(upperChunk, startChunk);
      verticalChunkConnect(centerChunk, upperChunk);

      const pickup = aom.pickup(new Set([createObject(200, startChunk.id)]));
      const expected = DirectedGraph.parse([
        [200, [201, 202]],
        [201, []],
        [202, []],
      ]);

      expect(pickup.equals(expected)).toBe(true);
    });

    test("应能选取空集的子图", () => {
      const pickupEmpty = aom.pickup(new Set());

      const expectedEmpty = DirectedGraph.parse([]);

      expect(pickupEmpty.equals(expectedEmpty)).toBe(true);
    });

    test("当某个二维覆盖区块不可达时，应跳过该区块并继续处理其它可达覆盖区块", () => {
      const centerChunk = createChunkAt(0, 0);
      const upChunk = createChunkAt(0, 1);
      const unreachableChunk = createChunkAt(1, 1);
      aom = new ActiveObjectManager(
        createBoard(centerChunk, upChunk, unreachableChunk),
      );

      centerChunk.objectManager = new ChunkObjectManager(centerChunk.id);
      upChunk.objectManager = new ChunkObjectManager(upChunk.id);
      unreachableChunk.objectManager = new ChunkObjectManager(unreachableChunk.id);

      centerChunk.objectManager.staticGraph = DirectedGraph.parse([[300, []]]);
      upChunk.objectManager.staticGraph = DirectedGraph.parse([
        [300, [302]],
        [302, []],
      ]);
      unreachableChunk.objectManager.staticGraph = DirectedGraph.parse([
        [300, [301]],
        [301, []],
      ]);

      setObjectCoverage([centerChunk, upChunk, unreachableChunk], [300]);

      verticalChunkConnect(centerChunk, upChunk);

      const pickup = aom.pickup(new Set([createObject(300, centerChunk.id)]));
      const expected = DirectedGraph.parse([
        [300, [302]],
        [302, []],
      ]);

      expect(pickup.equals(expected)).toBe(true);
    });

    test("覆盖区块集合更新后，应按新的二维覆盖区块索引拾取而不是沿用旧结果", () => {
      const centerChunk = createChunkAt(0, 0);
      const rightChunk = createChunkAt(1, 0);
      const upChunk = createChunkAt(0, 1);
      aom = new ActiveObjectManager(createBoard(centerChunk, rightChunk, upChunk));

      centerChunk.objectManager = new ChunkObjectManager(centerChunk.id);
      rightChunk.objectManager = new ChunkObjectManager(rightChunk.id);
      upChunk.objectManager = new ChunkObjectManager(upChunk.id);

      centerChunk.objectManager.staticGraph = DirectedGraph.parse([[400, []]]);
      rightChunk.objectManager.staticGraph = DirectedGraph.parse([
        [400, [401]],
        [401, []],
      ]);
      upChunk.objectManager.staticGraph = DirectedGraph.parse([
        [400, [402]],
        [402, []],
      ]);

      chunkConnect(centerChunk, rightChunk);
      verticalChunkConnect(centerChunk, upChunk);

      setObjectCoverage([centerChunk, rightChunk], [400]);

      const pickupBeforeMove = aom.pickup(
        new Set([createObject(400, centerChunk.id)]),
      );
      expect(
        pickupBeforeMove.equals(
          DirectedGraph.parse([
            [400, [401]],
            [401, []],
          ]),
        ),
      ).toBe(true);

      centerChunk.objectManager.setObjectCoverChunks(400, [
        centerChunk.id,
        upChunk.id,
      ]);
      upChunk.objectManager.setObjectCoverChunks(400, [centerChunk.id, upChunk.id]);
      rightChunk.objectManager.setObjectCoverChunks(400, [centerChunk.id]);

      const pickupAfterMove = aom.pickup(
        new Set([createObject(400, centerChunk.id)]),
      );
      expect(
        pickupAfterMove.equals(
          DirectedGraph.parse([
            [400, [402]],
            [402, []],
          ]),
        ),
      ).toBe(true);
    });
  });

  describe("优先使用 Board.createChunkBlockLoader", () => {
    test("pickup 应优先使用 Board.createChunkBlockLoader 且不再要求 Chunk 入参", () => {
      const chunk = createChunk(1);
      chunk.objectManager = new ChunkObjectManager(1);
      chunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);

      const board = {
        createChunkBlockLoader: jest.fn(() => new MockChunkBlockLoader()),
        getChunkById: jest.fn((chunkId) => (chunkId === 1 ? chunk : undefined)),
      };
      const aom = new ActiveObjectManager(board);

      const pickup8 = aom.pickup(
        new Set([new BasicObject(new Vector(0, 0), 8, 1)]),
      );
      const expected8 = DirectedGraph.parse([
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);

      expect(board.createChunkBlockLoader).toHaveBeenCalled();
      expect(pickup8.equals(expected8)).toBe(true);
    });
  });
});
