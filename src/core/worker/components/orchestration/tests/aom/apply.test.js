import { jest } from "@jest/globals";
import {
  createBoardCoreAomFixture,
  createChunk,
  createCoverChunkStorage,
} from "../../../../../test-support/aom-fixtures.js";
import { DirectedGraph } from "../../../../../utils/directed-graph.js";
import { Vector } from "../../../../../utils/math.js";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { Chunk } from "../../../chunk/chunk.js";
import { ChunkObjectManager } from "../../../chunk/chunk-object-manager.js";
import { StrokeObject } from "../../../../../shared/objects/stroke/stroke.js";
import { CircleObject } from "../../../../../shared/objects/graph/circle.js";
import { RectangleRange } from "../../../../../shared/range/index.js";

/**
 * AOM Worker 测试默认预加载的区块 ID 集合
 * @type {number[]}
 */
const DEFAULT_BOARD_CHUNK_IDS = Array.from(
  { length: 20 },
  (_, index) => index + 1,
);

/**
 * 创建供 AOM 集成测试使用的 Worker BoardCore
 * @param {{ width?: number, height?: number, chunkIds?: Iterable<number> }} [options={}] - BoardCore 初始化选项
 * @returns {import("../../board-core.js").BoardCore}
 */
function createWorkerBoard(options = {}) {
  const { boardCore } = createBoardCoreAomFixture({
    width: options.width ?? 10,
    height: options.height ?? 10,
    chunkIds: options.chunkIds ?? DEFAULT_BOARD_CHUNK_IDS,
  });
  return boardCore;
}

describe("ActiveObjectManager/apply", () => {
  describe("basic apply", () => {
    test("apply 应将活动对象写回 ChunkObjectManager 并同步覆盖区块索引", async () => {
      const board = createWorkerBoard({
        width: 10,
        height: 10,
      });

      const stroke = new StrokeObject(15, new Vector(0, 0));
      stroke.setData({
        points: [new Vector(1, 1), new Vector(19, 1), new Vector(19, 19)].map(
          (p) => ({ x: p.x, y: p.y }),
        ),
      });

      await board.activeObjectManager.choose(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      const ownerChunk = board.getChunkById(1);
      const coveredChunk = board.getChunkById(2);

      expect(board.activeObjectManager.activeObjectIndex.size).toBe(0);
      expect(ownerChunk.objectManager.getObject(15)).toBe(stroke);
      expect(ownerChunk.objectManager.getObjectCoverChunks(15)).toEqual(
        new Set([1, 2, 3]),
      );
      expect(coveredChunk.objectManager.getObjectCoverChunks(15)).toEqual(
        new Set([1, 2, 3]),
      );
      expect(ownerChunk.objectManager.staticGraph.hasNode(15)).toBe(true);
      expect(coveredChunk.objectManager.staticGraph.hasNode(15)).toBe(true);
    });

    test("apply 应根据活动层顺序为相交对象写回静态图上下关系", async () => {
      const board = createWorkerBoard({
        width: 10,
        height: 10,
      });

      const lower = new StrokeObject(21, new Vector(0, 0));
      lower.setData({
        points: [new Vector(1, 1), new Vector(8, 8)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      const upper = new StrokeObject(22, new Vector(0, 0));
      upper.setData({
        points: [new Vector(2, 2), new Vector(9, 9)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      await board.activeObjectManager.choose(new Set([lower]));
      await board.activeObjectManager.choose(new Set([upper]));
      board.activeObjectManager.apply(new Set([lower, upper]));

      const ownerChunk = board.getChunkById(1);
      expect(ownerChunk.objectManager.staticGraph.hasNode(21)).toBe(true);
      expect(ownerChunk.objectManager.staticGraph.hasNode(22)).toBe(true);
      expect(ownerChunk.objectManager.staticGraph.hasEdge(21, 22)).toBe(true);
    });

    test("apply 单独提交上层对象后应保留一个 inactive layer", async () => {
      const board = createWorkerBoard({
        width: 10,
        height: 10,
      });

      const lower = new StrokeObject(23, new Vector(0, 0));
      lower.setData({
        points: [new Vector(1, 1), new Vector(6, 6)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });
      const upper = new StrokeObject(24, new Vector(0, 0));
      upper.setData({
        points: [new Vector(2, 2), new Vector(7, 7)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      board.activeObjectManager.add(new Set([lower]));
      board.activeObjectManager.add(new Set([upper]));
      board.activeObjectManager.apply(new Set([upper]));

      expect(board.activeObjectManager.activeObjectIndex.has(23)).toBe(true);
      expect(board.activeObjectManager.activeObjectIndex.has(24)).toBe(false);
      expect(board.activeObjectManager.layerOrder.length).toBe(2);
      expect(board.activeObjectManager.layerOrder[0].active).toBe(true);
      expect(board.activeObjectManager.layerOrder[0].activeObjects).toEqual(
        new Set([23]),
      );
      expect(board.activeObjectManager.layerOrder[1].active).toBe(false);
      expect(board.activeObjectManager.layerOrder[1].activeObjects).toEqual(
        new Set([24]),
      );
    });

    test("apply 应为顺序创建的相交对象补上静态图连边", async () => {
      const board = createWorkerBoard({
        width: 10,
        height: 10,
      });

      const vertical = new StrokeObject(41, new Vector(0, 0));
      vertical.setData({
        points: [new Vector(5, 1), new Vector(5, 9)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      const horizontal = new StrokeObject(42, new Vector(0, 0));
      horizontal.setData({
        points: [new Vector(1, 5), new Vector(9, 5)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      board.activeObjectManager.add(new Set([vertical]));
      board.activeObjectManager.apply(new Set([vertical]));

      board.activeObjectManager.add(new Set([horizontal]));
      board.activeObjectManager.apply(new Set([horizontal]));

      const ownerChunk = board.getChunkById(1);
      expect(ownerChunk.objectManager.staticGraph.hasNode(41)).toBe(true);
      expect(ownerChunk.objectManager.staticGraph.hasNode(42)).toBe(true);
      expect(ownerChunk.objectManager.staticGraph.hasEdge(41, 42)).toBe(true);
      expect(ownerChunk.objectManager.staticGraph.hasEdge(42, 41)).toBe(false);
    });

    test("apply 应通过 renderHooks 触发刷新", async () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(
        1,
        createCoverChunkStorage(),
      );
      ownerChunk.objectManager.setObjectCoverChunks(201, [1, 2]);
      const coveredChunk = createChunk(2);
      coveredChunk.objectManager = new ChunkObjectManager(
        2,
        createCoverChunkStorage(),
      );

      const requestStaticRenderForObjects = jest.fn();
      const requestActiveRender = jest.fn();
      const requestStaticRender = jest.fn();
      const renderHooks = {
        requestActiveRender,
        requestStaticRender,
        requestStaticRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };

      const board = {
        width: 10,
        height: 10,
        getObjectById: jest.fn((objectId) =>
          objectId === 201 ? undefined : undefined,
        ),
        getChunkById: jest.fn((chunkId) => {
          if (chunkId === 1) return ownerChunk;
          if (chunkId === 2) return coveredChunk;
          return undefined;
        }),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board, { renderHooks });
      const stroke = new StrokeObject(201, new Vector(0, 0));
      stroke.setData({
        points: [new Vector(1, 1), new Vector(5, 5)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      aom.add(new Set([stroke]));
      requestActiveRender.mockClear();
      requestStaticRenderForObjects.mockClear();

      aom.apply(new Set([stroke]));

      expect(requestStaticRenderForObjects).toHaveBeenCalledTimes(1);
      expect(requestActiveRender).toHaveBeenCalledWith([stroke]);
    });

    test("apply 应优先按对象旧范围与新范围触发静态层局部失效", async () => {
      const stroke = new StrokeObject(301, new Vector(0, 0));
      stroke.setData({
        points: [new Vector(1, 1), new Vector(5, 5)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(
        1,
        createCoverChunkStorage(),
      );
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[301, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(301, [1]);

      const requestStaticRenderForObjects = jest.fn();
      const renderHooks = {
        requestActiveRender: jest.fn(),
        requestStaticRender: jest.fn(),
        requestStaticRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };

      const board = {
        width: 10,
        height: 10,
        getObjectById: jest.fn((objectId) =>
          objectId === 301 ? stroke : undefined,
        ),
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board, { renderHooks });

      await aom.choose(new Set([stroke]));
      // choose() 也会触发 base render invalidation，清计数以便仅验证 apply 的调用
      requestStaticRenderForObjects.mockClear();
      stroke.position = new Vector(100, 0);

      aom.apply(new Set([stroke]));

      expect(requestStaticRenderForObjects).toHaveBeenCalledTimes(1);
      const [objects, fallbackChunks, previousWorldRects] =
        requestStaticRenderForObjects.mock.calls[0];
      expect(previousWorldRects.get(301)).toEqual(
        RectangleRange.from(stroke.getRange().withPosition(new Vector(0, 0))),
      );
    });

    test("apply 在层级变化但几何不变时也应把受影响的静态邻接对象纳入局部失效", async () => {
      const lower = new StrokeObject(401, new Vector(0, 0));
      lower.setData({
        points: [new Vector(1, 1), new Vector(8, 8)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });
      const upper = new StrokeObject(402, new Vector(0, 0));
      upper.setData({
        points: [new Vector(2, 2), new Vector(9, 9)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(
        1,
        createCoverChunkStorage(),
      );
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([
        [401, [402]],
        [402, []],
      ]);
      ownerChunk.objectManager.setObjectCoverChunks(401, [1]);
      ownerChunk.objectManager.setObjectCoverChunks(402, [1]);

      const requestStaticRenderForObjects = jest.fn();
      const renderHooks = {
        requestActiveRender: jest.fn(),
        requestStaticRender: jest.fn(),
        requestStaticRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      const objectMap = new Map([
        [401, lower],
        [402, upper],
      ]);
      const board = {
        width: 10,
        height: 10,
        getObjectById: jest.fn((objectId) => objectMap.get(objectId)),
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board, { renderHooks });

      await aom.choose(new Set([lower]));
      aom.liftup(new Set([lower]));
      requestStaticRenderForObjects.mockClear();
      aom.apply(new Set([lower]));

      expect(requestStaticRenderForObjects).toHaveBeenCalledTimes(1);
      const [invalidatedObjects] = requestStaticRenderForObjects.mock.calls[0];
      expect(
        invalidatedObjects
          .map((objectInstance) => objectInstance.id)
          .sort((a, b) => a - b),
      ).toEqual([401, 402]);
    });
  });

  describe("stale chunk cleanup", () => {
    const CHUNK_WIDTH = 10;
    const CHUNK_HEIGHT = 10;

    /** 区块坐标 → id */
    function cid(x, y) {
      return Chunk.coordinateToId(x, y);
    }

    /**
     * 创建只覆盖 (0, 0) 区块的笔划对象
     */
    function strokeInChunk00(id) {
      const stroke = new StrokeObject(id, new Vector(0, 0));
      stroke.setData({
        points: [new Vector(1, 1), new Vector(4, 4)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });
      return stroke;
    }

    /**
     * 创建横跨 (0, 0) 和 (0, 1) 两个区块的笔划对象
     */
    function strokeCrossingChunk00And01(id) {
      const stroke = new StrokeObject(id, new Vector(0, 0));
      stroke.setData({
        points: [new Vector(1, 1), new Vector(4, 19)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });
      return stroke;
    }

    /**
     * 创建横跨 (0, 0)、(1, 0)、(2, 0) 三个横向区块的笔划对象
     */
    function strokeCrossingThreeChunks(id) {
      const stroke = new StrokeObject(id, new Vector(0, 0));
      stroke.setData({
        points: [new Vector(1, 1), new Vector(25, 4)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });
      return stroke;
    }

    test("对象跨区块移动后旧区块 COM 中节点、边和覆盖索引应被清理", async () => {
      const board = createWorkerBoard({
        width: CHUNK_WIDTH,
        height: CHUNK_HEIGHT,
      });

      const chunkId00 = cid(0, 0);
      const chunkId10 = cid(1, 0);

      const stroke = strokeInChunk00(101);
      board.activeObjectManager.add(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      const chunk00 = board.getChunkById(chunkId00);
      expect(chunk00.objectManager.staticGraph.hasNode(101)).toBe(true);
      expect(chunk00.objectManager.getObjectCoverChunks(101)).toEqual(
        new Set([chunkId00]),
      );

      // 选中（仍在 (0, 0)）→ 移到 (1, 0) → 提交
      await board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(CHUNK_WIDTH, 0);
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk00.objectManager.staticGraph.hasNode(101)).toBe(false);
      expect(board.getObjectCoverChunks(101)).toEqual(new Set([chunkId10]));

      const chunk10 = board.getChunkById(chunkId10);
      expect(chunk10.objectManager.staticGraph.hasNode(101)).toBe(true);
    });

    test("对象覆盖范围收缩后不再覆盖的旧区块应被清理", async () => {
      const board = createWorkerBoard({
        width: CHUNK_WIDTH,
        height: CHUNK_HEIGHT,
      });

      const chunkId00 = cid(0, 0);
      const chunkId10 = cid(1, 0);
      const chunkId20 = cid(2, 0);

      const stroke = strokeCrossingThreeChunks(102);
      board.activeObjectManager.add(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      const chunk00 = board.getChunkById(chunkId00);
      const chunk10 = board.getChunkById(chunkId10);
      const chunk20 = board.getChunkById(chunkId20);

      expect(chunk00.objectManager.staticGraph.hasNode(102)).toBe(true);
      expect(chunk10.objectManager.staticGraph.hasNode(102)).toBe(true);
      expect(chunk20.objectManager.staticGraph.hasNode(102)).toBe(true);
      expect(chunk00.objectManager.getObjectCoverChunks(102)).toEqual(
        new Set([chunkId00, chunkId10, chunkId20]),
      );

      // 选中 → 收缩到只覆盖 (0, 0) → 提交
      await board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(0, 0);
      stroke.setData({
        points: [new Vector(1, 1), new Vector(4, 4)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk10.objectManager.staticGraph.hasNode(102)).toBe(false);
      expect(board.getObjectCoverChunks(102)).toEqual(new Set([chunkId00]));
      expect(chunk20.objectManager.staticGraph.hasNode(102)).toBe(false);
      expect(board.getObjectCoverChunks(102)).toEqual(new Set([chunkId00]));
      expect(chunk00.objectManager.staticGraph.hasNode(102)).toBe(true);
      expect(chunk00.objectManager.getObjectCoverChunks(102)).toEqual(
        new Set([chunkId00]),
      );
    });

    test("对象覆盖范围不变时不做清理", async () => {
      const board = createWorkerBoard({
        width: CHUNK_WIDTH,
        height: CHUNK_HEIGHT,
      });

      const chunkId00 = cid(0, 0);
      const chunkId01 = cid(0, 1);

      const stroke = strokeCrossingChunk00And01(103);
      board.activeObjectManager.add(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      const chunk00 = board.getChunkById(chunkId00);
      const chunk01 = board.getChunkById(chunkId01);
      expect(chunk00.objectManager.staticGraph.hasNode(103)).toBe(true);
      expect(chunk01.objectManager.staticGraph.hasNode(103)).toBe(true);

      // 选中 → 不移动 → 再次提交
      await board.activeObjectManager.choose(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk00.objectManager.staticGraph.hasNode(103)).toBe(true);
      expect(chunk00.objectManager.getObjectCoverChunks(103)).toEqual(
        new Set([chunkId00, chunkId01]),
      );
      expect(chunk01.objectManager.staticGraph.hasNode(103)).toBe(true);
      expect(chunk01.objectManager.getObjectCoverChunks(103)).toEqual(
        new Set([chunkId00, chunkId01]),
      );
    });

    test("多个对象混合移动时每个对象只清理自己的旧区块", async () => {
      const board = createWorkerBoard({
        width: CHUNK_WIDTH,
        height: CHUNK_HEIGHT,
      });

      const chunkId00 = cid(0, 0);
      const chunkId10 = cid(1, 0);

      const objA = strokeInChunk00(104);
      const objB = strokeInChunk00(105);

      board.activeObjectManager.add(new Set([objA, objB]));
      board.activeObjectManager.apply(new Set([objA, objB]));

      const chunk00 = board.getChunkById(chunkId00);
      const chunk10 = board.getChunkById(chunkId10);
      expect(chunk00.objectManager.staticGraph.hasNode(104)).toBe(true);
      expect(chunk00.objectManager.staticGraph.hasNode(105)).toBe(true);
      expect(chunk10.objectManager?.staticGraph?.hasNode(104) ?? false).toBe(
        false,
      );
      expect(chunk10.objectManager?.staticGraph?.hasNode(105) ?? false).toBe(
        false,
      );

      // 选中 objB → 移动到 (1, 0) → 仅提交 objB
      await board.activeObjectManager.choose(new Set([objB]));
      objB.position = new Vector(CHUNK_WIDTH, 0);
      board.activeObjectManager.apply(new Set([objB]));

      expect(chunk00.objectManager.staticGraph.hasNode(104)).toBe(true);
      expect(chunk00.objectManager.staticGraph.hasNode(105)).toBe(false);
      expect(chunk10.objectManager.staticGraph.hasNode(104)).toBe(false);
      expect(chunk10.objectManager.staticGraph.hasNode(105)).toBe(true);
      expect(board.getObjectCoverChunks(105)).toEqual(new Set([chunkId10]));
      expect(board.getObjectCoverChunks(104)).toEqual(new Set([chunkId00]));
    });

    test("多次 apply 间跨区块移动的累积清理", async () => {
      const board = createWorkerBoard({
        width: CHUNK_WIDTH,
        height: CHUNK_HEIGHT,
      });

      const chunkId00 = cid(0, 0);
      const chunkId10 = cid(1, 0);
      const chunkId11 = cid(1, 1);

      const stroke = strokeInChunk00(106);
      board.activeObjectManager.add(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      const chunk00 = board.getChunkById(chunkId00);
      const chunk10 = board.getChunkById(chunkId10);
      const chunk11 = board.getChunkById(chunkId11);

      // 第一次：选中 → 移到 (1, 0) → 提交
      await board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(CHUNK_WIDTH, 0);
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk00.objectManager.staticGraph.hasNode(106)).toBe(false);
      expect(chunk10.objectManager.staticGraph.hasNode(106)).toBe(true);

      // 第二次：选中（仍在 (1, 0)）→ 移到 (1, 1) → 提交
      await board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(CHUNK_WIDTH, CHUNK_HEIGHT);
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk00.objectManager.staticGraph.hasNode(106)).toBe(false);
      expect(chunk10.objectManager.staticGraph.hasNode(106)).toBe(false);
      expect(chunk11.objectManager.staticGraph.hasNode(106)).toBe(true);
      expect(chunk11.objectManager.getObjectCoverChunks(106)).toEqual(
        new Set([chunkId11]),
      );
    });

    test("对象移出再移回后应重建静态图边", async () => {
      const board = createWorkerBoard({
        width: 800,
        height: 600,
      });

      const chunkId00 = cid(0, 0);

      // 两个同心圆对象，circle2 在 circle1 之下
      const circle1 = new CircleObject(
        1,
        new Vector(100, 100),
        {},
        { radius: 50 },
      );
      const circle2 = new CircleObject(
        2,
        new Vector(100, 100),
        {},
        { radius: 25 },
      );

      // 建立初始静态图：circle2 在 circle1 之下（边 2→1）
      board.activeObjectManager.add(new Set([circle2]));
      board.activeObjectManager.add(new Set([circle1]));
      board.activeObjectManager.apply(new Set([circle1, circle2]));

      const chunk = board.getChunkById(chunkId00);
      expect(chunk.objectManager.staticGraph.hasEdge(2, 1)).toBe(true);

      // 第一步：选择 circle2
      await board.activeObjectManager.choose(new Set([circle2]));

      // 第二步：将 circle2 移到不重叠的位置
      circle2.position = new Vector(200, 200);

      // 第三步：应用，此时相交关系消失，静态图中不应有任何边
      board.activeObjectManager.apply(new Set([circle2]));
      expect(chunk.objectManager.staticGraph.hasEdge(2, 1)).toBe(false);
      expect(chunk.objectManager.staticGraph.hasEdge(1, 2)).toBe(false);
      expect(chunk.objectManager.staticGraph.getNodes().length).toBe(2);

      // 第四步：重新选择 circle2（此时在 (200,200)，不与 circle1 相交）
      await board.activeObjectManager.choose(new Set([circle2]));

      // 断言动态图中只有 circle2
      expect(board.activeObjectManager.layerOrder.length).toBe(1);
      expect(board.activeObjectManager.layerOrder[0].activeObjects).toEqual(
        new Set([2]),
      );

      // 第五步：将 circle2 移回原来的同心位置
      circle2.position = new Vector(100, 100);

      // 第六步：应用，此时应重建边 1→2（circle1 在 circle2 之下）
      board.activeObjectManager.apply(new Set([circle2]));
      expect(chunk.objectManager.staticGraph.hasEdge(1, 2)).toBe(true);
      expect(chunk.objectManager.staticGraph.hasEdge(2, 1)).toBe(false);
    });

    test("选中对象后跨区块移动但 discard 时不清理旧区块", async () => {
      const board = createWorkerBoard({
        width: CHUNK_WIDTH,
        height: CHUNK_HEIGHT,
      });

      const chunkId00 = cid(0, 0);

      const stroke = strokeInChunk00(107);
      board.activeObjectManager.add(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      const chunk00 = board.getChunkById(chunkId00);

      // 选中 → 移到 (1, 0) → discard（放弃修改）
      await board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(CHUNK_WIDTH, 0);
      board.activeObjectManager.discard(new Set([stroke]));

      // discard 不写回静态结构，所以 (0, 0) 保留
      expect(chunk00.objectManager.staticGraph.hasNode(107)).toBe(true);
      expect(chunk00.objectManager.getObjectCoverChunks(107)).toEqual(
        new Set([chunkId00]),
      );
    });

    test("apply 同层活动的对象时应保留指向同层非活动对象的边缘", async () => {
      const board = createWorkerBoard({
        width: 10,
        height: 10,
      });

      const circle = new CircleObject(1, new Vector(5, 5), {}, { radius: 20 });
      const stroke = new StrokeObject(2, new Vector(0, 0));
      stroke.setData({
        points: [new Vector(0, 0), new Vector(9, 0), new Vector(9, 9)].map(
          (p) => ({ x: p.x, y: p.y }),
        ),
      });

      board.addObject(circle, 1);
      board.addObject(stroke, 1);

      // 手动建立静态边缘：圆(1) → 线(2)，表示线在圆之上
      const graph = board.getChunkById(1).objectManager.staticGraph;
      graph.addEdgeUnsafe(1, 2);

      expect(graph.hasEdge(1, 2)).toBe(true);

      // 仅选中圆（不选线）→ choose 会将线作为同层 inactive 加入
      await board.activeObjectManager.choose(new Set([circle]));

      // apply 仅提交圆
      board.activeObjectManager.apply(new Set([circle]));

      // 圆→线的边缘应保留
      expect(graph.hasNode(1)).toBe(true);
      expect(graph.hasNode(2)).toBe(true);
      expect(graph.hasEdge(1, 2)).toBe(true);
    });
  });

  describe("unloaded chunk", () => {
    /**
     * 创建不预加载任何区块的 BoardCore
     * @param {{ width?: number, height?: number }} [options={}] - 白板尺寸
     * @returns {import("../../board-core.js").BoardCore}
     */
    function createBlankBoard(options = {}) {
      const { boardCore } = createBoardCoreAomFixture({
        width: options.width ?? 100,
        height: options.height ?? 100,
        chunkIds: [],
      });
      return boardCore;
    }

    /**
     * 创建仅覆盖 (0, 0) 区块的简单笔划
     * @param {number} id - 对象 id
     * @returns {StrokeObject}
     */
    function simpleStroke(id) {
      const stroke = new StrokeObject(id, new Vector(10, 10));
      stroke.setData({
        points: [new Vector(10, 10), new Vector(30, 30)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });
      return stroke;
    }

    test("add 不应将对象写入未加载区块的静态图", () => {
      const board = createBlankBoard();
      const stroke = simpleStroke(501);
      const chunkId = Chunk.worldToChunkId(new Vector(10, 10), 100, 100);

      // add 前区块不存在于 chunkLoaded 中
      expect(board.chunkLoaded.has(chunkId)).toBe(false);

      board.activeObjectManager.add(new Set([stroke]));

      // 对象只在 AOM 中，区块未被创建
      expect(board.activeObjectManager.activeObjectIndex.has(501)).toBe(true);
      expect(board.chunkLoaded.has(chunkId)).toBe(false);
    });

    test("add 后 discard 不应创建或写入区块", () => {
      const board = createBlankBoard();
      const stroke = simpleStroke(502);
      const chunkId = Chunk.worldToChunkId(new Vector(10, 10), 100, 100);

      board.activeObjectManager.add(new Set([stroke]));
      expect(board.chunkLoaded.has(chunkId)).toBe(false);

      board.activeObjectManager.discard(new Set([stroke]));

      // discard 也不创建区块
      expect(board.chunkLoaded.has(chunkId)).toBe(false);
      expect(board.activeObjectManager.activeObjectIndex.size).toBe(0);
    });

    test("apply 应将未加载区块上的 AOM 对象写入区块静态图并设置覆盖索引", async () => {
      const board = createBlankBoard();
      const stroke = simpleStroke(503);

      board.activeObjectManager.add(new Set([stroke]));

      await board.activeObjectManager.apply(new Set([stroke]));

      // 对象已不在 AOM
      expect(board.activeObjectManager.activeObjectIndex.size).toBe(0);

      // 区块被创建，对象写入静态图
      const chunkId = Chunk.worldToChunkId(new Vector(10, 10), 100, 100);
      expect(board.chunkLoaded.has(chunkId)).toBe(true);
      const chunk = board.getChunkById(chunkId);
      expect(chunk.objectManager.staticGraph.hasNode(503)).toBe(true);
      expect(chunk.objectManager.getObjectCoverChunks(503)).toEqual(
        new Set([chunkId]),
      );
    });

    test("apply 应正确写入跨越多区块的对象到所有覆盖区块的静态图中", async () => {
      const board = createBlankBoard();

      const stroke = new StrokeObject(504, new Vector(0, 0));
      stroke.setData({
        points: [new Vector(1, 1), new Vector(150, 150)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      board.activeObjectManager.add(new Set([stroke]));

      await board.activeObjectManager.apply(new Set([stroke]));

      expect(board.activeObjectManager.activeObjectIndex.size).toBe(0);

      // 笔划从 (1,1) 到 (150,150) 跨越 (0,0) (1,0) (1,1) (0,1) 四个区块
      const coveredIds = [1, 2, 3, 4];
      for (const cid of coveredIds) {
        expect(board.chunkLoaded.has(cid)).toBe(true);
        const chunk = board.getChunkById(cid);
        expect(chunk.objectManager.staticGraph.hasNode(504)).toBe(true);
      }
    });

    test("apply 多次提交对象到未加载区块后区块引用计数正确", async () => {
      const board = createBlankBoard();

      const obj1 = simpleStroke(505);
      const obj2 = new StrokeObject(506, new Vector(10, 10));
      obj2.setData({
        points: [new Vector(10, 10), new Vector(20, 20)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      // 第一次提交
      board.activeObjectManager.add(new Set([obj1]));
      await board.activeObjectManager.apply(new Set([obj1]));

      const chunkId = Chunk.worldToChunkId(new Vector(10, 10), 100, 100);
      const chunk = board.getChunkById(chunkId);
      expect(chunk.objectManager.staticGraph.hasNode(505)).toBe(true);

      // 第二次提交同一区块的新对象
      board.activeObjectManager.add(new Set([obj2]));
      await board.activeObjectManager.apply(new Set([obj2]));

      expect(chunk.objectManager.staticGraph.hasNode(506)).toBe(true);
      // 第一次提交的对象仍然存在
      expect(chunk.objectManager.staticGraph.hasNode(505)).toBe(true);
    });

    test("choose 可以将未加载区块上的 AOM 对象成功选中", async () => {
      const board = createBlankBoard();
      const stroke = simpleStroke(601);

      board.activeObjectManager.add(new Set([stroke]));

      const chunkId = Chunk.worldToChunkId(new Vector(10, 10), 100, 100);
      expect(board.chunkLoaded.has(chunkId)).toBe(false);

      // choose 触发 pickup，内部 temp-load 未加载区块
      await board.activeObjectManager.choose(new Set([stroke]));

      // 对象在 AOM 中
      expect(board.activeObjectManager.activeObjectIndex.has(601)).toBe(true);
      // 区块已被 temp-load
      expect(board.chunkLoaded.has(chunkId)).toBe(true);
      const chunk = board.getChunkById(chunkId);
      expect(chunk.isLoad).toBe(true);
    });

    test("choose 在 apply 之后可以从静态图中检出邻接对象", async () => {
      const board = createBlankBoard();

      // 创建两个相交的对象，先提交到静态图
      const lower = new StrokeObject(602, new Vector(0, 0));
      lower.setData({
        points: [new Vector(1, 1), new Vector(30, 30)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });
      const upper = new StrokeObject(603, new Vector(0, 0));
      upper.setData({
        points: [new Vector(10, 10), new Vector(40, 40)].map((p) => ({
          x: p.x,
          y: p.y,
        })),
      });

      board.activeObjectManager.add(new Set([lower]));
      board.activeObjectManager.add(new Set([upper]));
      await board.activeObjectManager.apply(new Set([lower, upper]));

      // 两个对象都在静态图中，AOM 为空
      expect(board.activeObjectManager.activeObjectIndex.size).toBe(0);

      const chunkId = Chunk.worldToChunkId(new Vector(10, 10), 100, 100);
      const chunk = board.getChunkById(chunkId);
      expect(chunk.objectManager.staticGraph.hasNode(602)).toBe(true);
      expect(chunk.objectManager.staticGraph.hasNode(603)).toBe(true);

      // choose 下层对象：pickup 应检出上层对象及其静态图边
      await board.activeObjectManager.choose(new Set([lower]));

      // 下层对象进入 AOM
      expect(board.activeObjectManager.activeObjectIndex.has(602)).toBe(true);
      // 上层对象作为 inactive 上下文也被检出
      const layer = board.activeObjectManager.layerOrder[0];
      expect(layer.activeObjects.has(602)).toBe(true);
      expect(layer.inactiveGraph.hasNode(603)).toBe(true);
      // 边在静态图中，不在 inactiveGraph（602 是 active 对象）
      expect(chunk.objectManager.staticGraph.hasEdge(602, 603)).toBe(true);
    });
  });
});
