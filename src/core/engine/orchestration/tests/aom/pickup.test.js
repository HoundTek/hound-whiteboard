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
} from "../../../../test-support/aom-fixtures.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Chunk } from "../../../chunk/chunk.js";
import { ChunkObjectManager } from "../../../chunk/chunk-object-manager.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { Vector } from "../../../utils/math.js";
import { EventBus } from "../../../utils/event-bus.js";
import { CHUNK_LOAD_EVENTS } from "../../../chunk/chunk-loader.js";
import { oneChunkData, twoChunkData, multiChunkData } from "./data.js";
const { ActiveObjectManager } = await import("../../active-object-manager.js");
describe("ActiveObjectManager/pickup", () => {
  let aom = new ActiveObjectManager();
  beforeEach(() => {
    aom = new ActiveObjectManager();
  });
  const CHUNK_SIZE = 100;
  /**
   * 根据区块 id 计算对象位置，使 worldToChunkId 映射到该区块
   * @param {number} id - 对象 id
   * @param {number} chunkId - 目标区块 id
   * @returns {BasicObject}
   */
  function createObject(id, chunkId) {
    return createObjectInChunk(id, chunkId, CHUNK_SIZE);
  }
  describe("选取无跨区块对象的子图", () => {
    let chunk = createChunk(1);
    beforeEach(() => {
      chunk = createChunk(1);
      chunk.objectManager = new ChunkObjectManager(
        1,
        createCoverChunkStorage(),
      );
      chunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);
      aom = new ActiveObjectManager(
        createMockBoard([chunk], { width: CHUNK_SIZE, height: CHUNK_SIZE }),
      );
    });
    test("应能选取单对象为起点且无跨区块对象的子图", async () => {
      const pickup8 = await aom.pickup(new Set([createObject(8, chunk.id)]));
      const expected8 = DirectedGraph.parse([
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);
      expect(pickup8.equals(expected8)).toBe(true);
      const pickup11 = await aom.pickup(new Set([createObject(11, chunk.id)]));
      const expected11 = DirectedGraph.parse([
        [11, [7]],
        [7, [4]],
        [4, [2]],
        [2, [1]],
        [1, []],
      ]);
      expect(pickup11.equals(expected11)).toBe(true);
    });
    test("应能选取多对象为起点且无跨区块对象的子图", async () => {
      const pickup8n15 = await aom.pickup(
        new Set([createObject(8, chunk.id), createObject(15, chunk.id)]),
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
      aom = new ActiveObjectManager(
        createMockBoard([chunk1, chunk2], {
          width: CHUNK_SIZE,
          height: CHUNK_SIZE,
        }),
      );
      chunkConnect(chunk1, chunk2);
      chunk1.objectManager = new ChunkObjectManager(
        1,
        createCoverChunkStorage(),
      );
      chunk2.objectManager = new ChunkObjectManager(
        2,
        createCoverChunkStorage(),
      );
      chunk1.objectManager.staticGraph = DirectedGraph.parse(twoChunkData[0]);
      chunk2.objectManager.staticGraph = DirectedGraph.parse(twoChunkData[1]);
      setObjectCoverage([chunk1, chunk2], [15, 17, 18]);
    });
    test("应能选取单对象为起点且含跨区块对象的子图", async () => {
      const pickup18 = await aom.pickup(new Set([createObject(18, chunk2.id)]));
      const expected18 = DirectedGraph.parse([
        [18, [6]],
        [6, [3]],
        [3, [1]],
        [1, []],
      ]);
      expect(pickup18.equals(expected18)).toBe(true);
      const pickup15 = await aom.pickup(new Set([createObject(15, chunk1.id)]));
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
    test("应能选取多对象为起点且含跨区块对象的子图", async () => {
      const pickup8n10 = await aom.pickup(
        new Set([createObject(8, chunk1.id), createObject(10, chunk1.id)]),
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
      aom = new ActiveObjectManager(
        createMockBoard([chunk1, chunk2, chunk3, chunk4, chunk5], {
          width: CHUNK_SIZE,
          height: CHUNK_SIZE,
        }),
      );
      chunk1.objectManager = new ChunkObjectManager(
        chunk1.id,
        createCoverChunkStorage(),
      );
      chunk2.objectManager = new ChunkObjectManager(
        chunk2.id,
        createCoverChunkStorage(),
      );
      chunk3.objectManager = new ChunkObjectManager(
        chunk3.id,
        createCoverChunkStorage(),
      );
      chunk4.objectManager = new ChunkObjectManager(
        chunk4.id,
        createCoverChunkStorage(),
      );
      chunk5.objectManager = new ChunkObjectManager(
        chunk5.id,
        createCoverChunkStorage(),
      );
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
    test("应能选取多对象为起点且含多区块跨区块对象链的子图", async () => {
      const pickup6n19 = await aom.pickup(
        new Set([createObject(6, chunk3.id), createObject(19, chunk1.id)]),
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
    test("应能在二维区块中先横向后纵向移动，并在回到原区块后继续遍历其它覆盖区块", async () => {
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
      const pickup = await aom.pickup(
        new Set([createObject(100, centerChunk.id)]),
      );
      const expected = DirectedGraph.parse([
        [100, [101, 103, 104]],
        [101, []],
        [103, []],
        [104, []],
      ]);
      expect(pickup.equals(expected)).toBe(true);
    });
    test("应能在二维区块中向左下方向移动到覆盖区块", async () => {
      const centerChunk = createChunkAt(0, 0);
      const upperChunk = createChunkAt(0, 1);
      const startChunk = createChunkAt(1, 1);
      aom = new ActiveObjectManager(
        createMockBoard([centerChunk, upperChunk, startChunk], {
          width: CHUNK_SIZE,
          height: CHUNK_SIZE,
        }),
      );
      centerChunk.objectManager = new ChunkObjectManager(
        centerChunk.id,
        createCoverChunkStorage(),
      );
      upperChunk.objectManager = new ChunkObjectManager(
        upperChunk.id,
        createCoverChunkStorage(),
      );
      startChunk.objectManager = new ChunkObjectManager(
        startChunk.id,
        createCoverChunkStorage(),
      );
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
      const pickup = await aom.pickup(
        new Set([createObject(200, startChunk.id)]),
      );
      const expected = DirectedGraph.parse([
        [200, [201, 202]],
        [201, []],
        [202, []],
      ]);
      expect(pickup.equals(expected)).toBe(true);
    });
    test("应能选取空集的子图", async () => {
      const pickupEmpty = await aom.pickup(new Set());
      const expectedEmpty = DirectedGraph.parse([]);
      expect(pickupEmpty.equals(expectedEmpty)).toBe(true);
    });
    test("当某个覆盖区块不在 Board 的 chunkMap 中时，应跳过该区块并继续处理其它可达覆盖区块", async () => {
      const centerChunk = createChunkAt(0, 0);
      const upChunk = createChunkAt(0, 1);
      // (1,1) 区块不在 board 中
      aom = new ActiveObjectManager(
        createMockBoard([centerChunk, upChunk], {
          width: CHUNK_SIZE,
          height: CHUNK_SIZE,
        }),
      );
      centerChunk.objectManager = new ChunkObjectManager(
        centerChunk.id,
        createCoverChunkStorage(),
      );
      upChunk.objectManager = new ChunkObjectManager(
        upChunk.id,
        createCoverChunkStorage(),
      );
      centerChunk.objectManager.staticGraph = DirectedGraph.parse([[300, []]]);
      upChunk.objectManager.staticGraph = DirectedGraph.parse([
        [300, [302]],
        [302, []],
      ]);
      setObjectCoverage([centerChunk, upChunk], [300]);
      // 覆盖索引包含一个不存在的区块
      centerChunk.objectManager.setObjectCoverChunks(300, [
        centerChunk.id,
        upChunk.id,
        Chunk.coordinateToId(1, 1),
      ]);
      verticalChunkConnect(centerChunk, upChunk);
      const pickup = await aom.pickup(
        new Set([createObject(300, centerChunk.id)]),
      );
      const expected = DirectedGraph.parse([
        [300, [302]],
        [302, []],
      ]);
      expect(pickup.equals(expected)).toBe(true);
    });
    test("覆盖区块集合更新后，应按新的二维覆盖区块索引拾取而不是沿用旧结果", async () => {
      const centerChunk = createChunkAt(0, 0);
      const rightChunk = createChunkAt(1, 0);
      const upChunk = createChunkAt(0, 1);
      aom = new ActiveObjectManager(
        createMockBoard([centerChunk, rightChunk, upChunk], {
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
      const pickupBeforeMove = await aom.pickup(
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
      upChunk.objectManager.setObjectCoverChunks(400, [
        centerChunk.id,
        upChunk.id,
      ]);
      rightChunk.objectManager.setObjectCoverChunks(400, [centerChunk.id]);
      const pickupAfterMove = await aom.pickup(
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
  describe("优先使用 Board.createChunkLoader", () => {
    test("pickup 应优先使用 Board.createChunkLoader", async () => {
      const chunk = createChunk(1);
      chunk.objectManager = new ChunkObjectManager(
        1,
        createCoverChunkStorage(),
      );
      chunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);
      const board = {
        width: 100,
        height: 100,
        getChunkById: jest.fn((chunkId) => (chunkId === 1 ? chunk : undefined)),
        getChunkByCoordinate: jest.fn((x, y) =>
          x === 0 && y === 0 ? chunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board);
      const pickup8 = await aom.pickup(
        new Set([new BasicObject(8, new Vector(0, 0))]),
      );
      const expected8 = DirectedGraph.parse([
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);
      expect(pickup8.equals(expected8)).toBe(true);
    });
  });
  describe("跨区块加载", () => {
    test("遍历到未加载区块时应 TempLoad 并等待完成后继续", async () => {
      const chunk1 = createChunk(1);
      chunk1.objectManager = new ChunkObjectManager(
        1,
        createCoverChunkStorage(),
      );
      chunk1.objectManager.staticGraph = DirectedGraph.parse(twoChunkData[0]);
      // 标记覆盖关系：对象 10、15、17、18 跨区块
      chunk1.objectManager.setObjectCoverChunks(15, [1, 2]);
      chunk1.objectManager.setObjectCoverChunks(17, [1, 2]);
      chunk1.objectManager.setObjectCoverChunks(18, [1, 2]);
      // chunk2 处于未加载状态
      const chunk2 = Chunk.fromId(2);
      chunk2.x = 1;
      chunk2.y = 0;
      chunk2.objectManager = new ChunkObjectManager(
        2,
        createCoverChunkStorage(),
      );
      chunk2.objectManager.staticGraph = DirectedGraph.parse(twoChunkData[1]);
      chunk2.objectManager.setObjectCoverChunks(15, [1, 2]);
      chunk2.objectManager.setObjectCoverChunks(16, [2]);
      chunk2.objectManager.setObjectCoverChunks(17, [1, 2]);
      chunk2.objectManager.setObjectCoverChunks(18, [1, 2]);
      const emitLoadMock = jest.fn((chunk, _options) => {
        // 模拟 BoardCore 的异步加载：下个微任务完成 TempLoad
        queueMicrotask(() => {
          chunk.isLoad = true;
          chunk.isTempLoad = true;
          eventBus.emit(CHUNK_LOAD_EVENTS.LOAD_COMPLETE, {
            chunkId: chunk.id,
          });
        });
      });
      const eventBus = new EventBus();
      const board = {
        width: 100,
        height: 100,
        getChunkById: (chunkId) =>
          chunkId === 1 ? chunk1 : chunkId === 2 ? chunk2 : undefined,
        getChunkByCoordinate: (x, y) => {
          if (x === 0 && y === 0) return chunk1;
          if (x === 1 && y === 0) return chunk2;
          return undefined;
        },
        chunkLoadEventBus: eventBus,
        createChunkLoader: () => ({
          trackChunk: jest.fn(),
          emitLoadRequest: emitLoadMock,
          destroy: jest.fn(),
        }),
        destroyChunkLoader: jest.fn(),
      };
      const aom = new ActiveObjectManager(board);
      // 从 chunk1 的对象 15 出发，应能跨到 chunk2 并拿到 16、17、18
      const result = await aom.pickup(new Set([createObject(15, 1)]));
      expect(result.hasNode(15)).toBe(true);
      expect(result.hasNode(16)).toBe(true);
      expect(result.hasNode(17)).toBe(true);
      expect(result.hasNode(18)).toBe(true);
      // chunk2 已加载
      expect(chunk2.isLoad).toBe(true);
      expect(chunk2.isTempLoad).toBe(true);
      // emitLoadRequest 被调用了
      expect(emitLoadMock).toHaveBeenCalledWith(
        chunk2,
        expect.objectContaining({ strategy: "temp" }),
      );
    });
  });
});
