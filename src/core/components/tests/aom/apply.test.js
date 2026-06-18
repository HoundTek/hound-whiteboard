import { jest } from "@jest/globals";
import { createChunk } from "../../../test-support/aom-fixtures.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Vector } from "../../../utils/math.js";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { Board } from "../../board.js";
import { Chunk } from "../../chunk.js";
import { ChunkObjectManager } from "../../chunk-object-manager.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";
import { CircleObject } from "../../../objects/graph/circle.js";
import { MockChunkBlockLoader } from "./chunk-block-loader.mock.js";
import { RectangleRange } from "../../../range/index.js";

describe("ActiveObjectManager/apply", () => {
  describe("basic apply", () => {
    test("apply 应将活动对象写回 ChunkObjectManager 并同步覆盖区块索引", () => {
      const board = new Board();
      board.width = 10;
      board.height = 10;

      const stroke = new StrokeObject(new Vector(0, 0), 15, 1);
      stroke.setPathPoints([
        new Vector(1, 1),
        new Vector(19, 1),
        new Vector(19, 19),
      ]);

      board.activeObjectManager.choose(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      const ownerChunk = board.getChunkById(1);
      const coveredChunk = board.getChunkById(2);

      expect(board.activeObjectManager.activeObjects.size).toBe(0);
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

    test("apply 应根据活动层顺序为相交对象写回静态图上下关系", () => {
      const board = new Board();
      board.width = 10;
      board.height = 10;

      const lower = new StrokeObject(new Vector(0, 0), 21, 1);
      lower.setPathPoints([new Vector(1, 1), new Vector(8, 8)]);

      const upper = new StrokeObject(new Vector(0, 0), 22, 1);
      upper.setPathPoints([new Vector(2, 2), new Vector(9, 9)]);

      board.activeObjectManager.choose(new Set([lower]));
      board.activeObjectManager.choose(new Set([upper]));
      board.activeObjectManager.apply(new Set([lower, upper]));

      const ownerChunk = board.getChunkById(1);
      expect(ownerChunk.objectManager.staticGraph.hasNode(21)).toBe(true);
      expect(ownerChunk.objectManager.staticGraph.hasNode(22)).toBe(true);
      expect(ownerChunk.objectManager.staticGraph.hasEdge(21, 22)).toBe(true);
    });

    test("apply 应为顺序创建的相交对象补上静态图连边", () => {
      const board = new Board();
      board.width = 10;
      board.height = 10;

      const vertical = new StrokeObject(new Vector(0, 0), 41, 1);
      vertical.setPathPoints([new Vector(5, 1), new Vector(5, 9)]);

      const horizontal = new StrokeObject(new Vector(0, 0), 42, 1);
      horizontal.setPathPoints([new Vector(1, 5), new Vector(9, 5)]);

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

    test("apply 应触发 monitor.liveRenderer.invalidateObjects", () => {
      const invalidatedChunks = [];
      const monitor = {
        baseRenderer: {
          invalidateChunks: jest.fn((chunks) => {
            invalidatedChunks.push(...chunks);
          }),
        },
        liveRenderer: {
          collectActiveDrawables: jest.fn(() => []),
          invalidateObjects: jest.fn(),
        },
        renderScheduler: { invalidate: jest.fn() },
      };
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.setObjectCoverChunks(201, [1, 2]);
      const coveredChunk = createChunk(2);
      coveredChunk.objectManager = new ChunkObjectManager(2);
      const board = {
        width: 10,
        height: 10,
        monitors: new Map([["main", monitor]]),
        getObjectById: jest.fn((objectId) =>
          objectId === 201 ? stroke : undefined,
        ),
        getChunkById: jest.fn((chunkId) => {
          if (chunkId === 1) return ownerChunk;
          if (chunkId === 2) return coveredChunk;
          return undefined;
        }),
      };
      const aom = new ActiveObjectManager(board);
      const stroke = new StrokeObject(new Vector(0, 0), 201, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(5, 5)]);

      aom.add(new Set([stroke]));
      monitor.liveRenderer.invalidateObjects.mockClear();

      aom.apply(new Set([stroke]));

      expect(monitor.baseRenderer.invalidateChunks).toHaveBeenCalledTimes(1);
      expect(
        invalidatedChunks.map((chunk) => chunk.id).sort((a, b) => a - b),
      ).toEqual([1, 2]);
      expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledWith([
        stroke,
      ]);
    });

    test("apply 应优先按对象旧范围与新范围触发静态层局部失效", () => {
      const stroke = new StrokeObject(new Vector(0, 0), 301, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(5, 5)]);

      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[301, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(301, [1]);

      const monitor = {
        baseRenderer: {
          invalidateObjects: jest.fn(() => [new RectangleRange(0, 0, 4, 4)]),
          invalidateChunks: jest.fn(),
        },
        liveRenderer: {
          collectActiveDrawables: jest.fn(() => []),
          invalidateObjects: jest.fn(),
        },
        renderScheduler: { invalidate: jest.fn() },
      };
      const board = {
        width: 10,
        height: 10,
        monitors: new Map([["main", monitor]]),
        getObjectById: jest.fn((objectId) =>
          objectId === 301 ? stroke : undefined,
        ),
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkBlockLoader: jest.fn(() => new MockChunkBlockLoader()),
      };
      const aom = new ActiveObjectManager(board);

      aom.choose(new Set([stroke]));
      stroke.position = new Vector(100, 0);

      aom.apply(new Set([stroke]));

      expect(monitor.baseRenderer.invalidateObjects).toHaveBeenCalledTimes(1);
      const [, options] = monitor.baseRenderer.invalidateObjects.mock.calls[0];
      expect(monitor.baseRenderer.invalidateChunks).not.toHaveBeenCalled();
      expect(options.previousWorldRects.get(301)).toEqual(
        RectangleRange.from(stroke.getRange().withPosition(new Vector(0, 0))),
      );
    });

    test("apply 在层级变化但几何不变时也应把受影响的静态邻接对象纳入局部失效", () => {
      const lower = new StrokeObject(new Vector(0, 0), 401, 1);
      lower.setPathPoints([new Vector(1, 1), new Vector(8, 8)]);
      const upper = new StrokeObject(new Vector(0, 0), 402, 1);
      upper.setPathPoints([new Vector(2, 2), new Vector(9, 9)]);

      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([
        [401, [402]],
        [402, []],
      ]);
      ownerChunk.objectManager.setObjectCoverChunks(401, [1]);
      ownerChunk.objectManager.setObjectCoverChunks(402, [1]);

      const monitor = {
        baseRenderer: {
          invalidateObjects: jest.fn(() => [new RectangleRange(0, 0, 10, 10)]),
          invalidateChunks: jest.fn(),
        },
        liveRenderer: {
          collectActiveDrawables: jest.fn(() => []),
          invalidateObjects: jest.fn(),
        },
        renderScheduler: { invalidate: jest.fn() },
      };
      const objectMap = new Map([
        [401, lower],
        [402, upper],
      ]);
      const board = {
        width: 10,
        height: 10,
        monitors: new Map([["main", monitor]]),
        getObjectById: jest.fn((objectId) => objectMap.get(objectId)),
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkBlockLoader: jest.fn(() => new MockChunkBlockLoader()),
      };
      const aom = new ActiveObjectManager(board);

      aom.choose(new Set([lower]));
      aom.liftup(new Set([lower]));
      aom.apply(new Set([lower]));

      expect(monitor.baseRenderer.invalidateObjects).toHaveBeenCalledTimes(1);
      const [invalidatedObjects] =
        monitor.baseRenderer.invalidateObjects.mock.calls[0];
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
      const stroke = new StrokeObject(new Vector(0, 0), id, cid(0, 0));
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);
      return stroke;
    }

    /**
     * 创建横跨 (0, 0) 和 (0, 1) 两个区块的笔划对象
     */
    function strokeCrossingChunk00And01(id) {
      const stroke = new StrokeObject(new Vector(0, 0), id, cid(0, 0));
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 19)]);
      return stroke;
    }

    /**
     * 创建横跨 (0, 0)、(1, 0)、(2, 0) 三个横向区块的笔划对象
     */
    function strokeCrossingThreeChunks(id) {
      const stroke = new StrokeObject(new Vector(0, 0), id, cid(0, 0));
      stroke.setPathPoints([new Vector(1, 1), new Vector(25, 4)]);
      return stroke;
    }

    test("对象跨区块移动后旧区块 COM 中节点、边和覆盖索引应被清理", () => {
      const board = new Board();
      board.width = CHUNK_WIDTH;
      board.height = CHUNK_HEIGHT;

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
      board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(CHUNK_WIDTH, 0);
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk00.objectManager.staticGraph.hasNode(101)).toBe(false);
      expect(chunk00.objectManager.getObjectCoverChunks(101)).toEqual(
        new Set(),
      );

      const chunk10 = board.getChunkById(chunkId10);
      expect(chunk10.objectManager.staticGraph.hasNode(101)).toBe(true);
      expect(chunk10.objectManager.getObjectCoverChunks(101)).toEqual(
        new Set([chunkId10]),
      );
    });

    test("对象覆盖范围收缩后不再覆盖的旧区块应被清理", () => {
      const board = new Board();
      board.width = CHUNK_WIDTH;
      board.height = CHUNK_HEIGHT;

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
      board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(0, 0);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk10.objectManager.staticGraph.hasNode(102)).toBe(false);
      expect(chunk10.objectManager.getObjectCoverChunks(102)).toEqual(
        new Set(),
      );
      expect(chunk20.objectManager.staticGraph.hasNode(102)).toBe(false);
      expect(chunk20.objectManager.getObjectCoverChunks(102)).toEqual(
        new Set(),
      );
      expect(chunk00.objectManager.staticGraph.hasNode(102)).toBe(true);
      expect(chunk00.objectManager.getObjectCoverChunks(102)).toEqual(
        new Set([chunkId00]),
      );
    });

    test("对象覆盖范围不变时不做清理", () => {
      const board = new Board();
      board.width = CHUNK_WIDTH;
      board.height = CHUNK_HEIGHT;

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
      board.activeObjectManager.choose(new Set([stroke]));
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

    test("多个对象混合移动时每个对象只清理自己的旧区块", () => {
      const board = new Board();
      board.width = CHUNK_WIDTH;
      board.height = CHUNK_HEIGHT;

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
      board.activeObjectManager.choose(new Set([objB]));
      objB.position = new Vector(CHUNK_WIDTH, 0);
      board.activeObjectManager.apply(new Set([objB]));

      expect(chunk00.objectManager.staticGraph.hasNode(104)).toBe(true);
      expect(chunk00.objectManager.staticGraph.hasNode(105)).toBe(false);
      expect(chunk10.objectManager.staticGraph.hasNode(104)).toBe(false);
      expect(chunk10.objectManager.staticGraph.hasNode(105)).toBe(true);
      expect(chunk00.objectManager.getObjectCoverChunks(105)).toEqual(
        new Set(),
      );
      expect(chunk10.objectManager.getObjectCoverChunks(105)).toEqual(
        new Set([chunkId10]),
      );
      expect(chunk00.objectManager.getObjectCoverChunks(104)).toEqual(
        new Set([chunkId00]),
      );
    });

    test("多次 apply 间跨区块移动的累积清理", () => {
      const board = new Board();
      board.width = CHUNK_WIDTH;
      board.height = CHUNK_HEIGHT;

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
      board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(CHUNK_WIDTH, 0);
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk00.objectManager.staticGraph.hasNode(106)).toBe(false);
      expect(chunk10.objectManager.staticGraph.hasNode(106)).toBe(true);

      // 第二次：选中（仍在 (1, 0)）→ 移到 (1, 1) → 提交
      board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(CHUNK_WIDTH, CHUNK_HEIGHT);
      board.activeObjectManager.apply(new Set([stroke]));

      expect(chunk00.objectManager.staticGraph.hasNode(106)).toBe(false);
      expect(chunk10.objectManager.staticGraph.hasNode(106)).toBe(false);
      expect(chunk11.objectManager.staticGraph.hasNode(106)).toBe(true);
      expect(chunk11.objectManager.getObjectCoverChunks(106)).toEqual(
        new Set([chunkId11]),
      );
    });

    test("对象移出再移回后应重建静态图边", () => {
      const board = new Board();
      board.width = 800;
      board.height = 600;

      const chunkId00 = cid(0, 0);

      // 两个同心圆对象，circle2 在 circle1 之下
      const circle1 = new CircleObject(new Vector(100, 100), 1, chunkId00, 50);
      const circle2 = new CircleObject(new Vector(100, 100), 2, chunkId00, 25);

      // 建立初始静态图：circle2 在 circle1 之下（边 2→1）
      board.activeObjectManager.add(new Set([circle2]));
      board.activeObjectManager.add(new Set([circle1]));
      board.activeObjectManager.apply(new Set([circle1, circle2]));

      const chunk = board.getChunkById(chunkId00);
      expect(chunk.objectManager.staticGraph.hasEdge(2, 1)).toBe(true);

      // 第一步：选择 circle2
      board.activeObjectManager.choose(new Set([circle2]));

      // 第二步：将 circle2 移到不重叠的位置
      circle2.position = new Vector(200, 200);

      // 第三步：应用，此时相交关系消失，静态图中不应有任何边
      board.activeObjectManager.apply(new Set([circle2]));
      expect(chunk.objectManager.staticGraph.hasEdge(2, 1)).toBe(false);
      expect(chunk.objectManager.staticGraph.hasEdge(1, 2)).toBe(false);
      expect(chunk.objectManager.staticGraph.getNodes().length).toBe(2);

      // 第四步：重新选择 circle2（此时在 (200,200)，不与 circle1 相交）
      board.activeObjectManager.choose(new Set([circle2]));

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

    test("选中对象后跨区块移动但 discard 时不清理旧区块", () => {
      const board = new Board();
      board.width = CHUNK_WIDTH;
      board.height = CHUNK_HEIGHT;

      const chunkId00 = cid(0, 0);

      const stroke = strokeInChunk00(107);
      board.activeObjectManager.add(new Set([stroke]));
      board.activeObjectManager.apply(new Set([stroke]));

      const chunk00 = board.getChunkById(chunkId00);

      // 选中 → 移到 (1, 0) → discard（放弃修改）
      board.activeObjectManager.choose(new Set([stroke]));
      stroke.position = new Vector(CHUNK_WIDTH, 0);
      board.activeObjectManager.discard(new Set([stroke]));

      // discard 不写回静态结构，所以 (0, 0) 保留
      expect(chunk00.objectManager.staticGraph.hasNode(107)).toBe(true);
      expect(chunk00.objectManager.getObjectCoverChunks(107)).toEqual(
        new Set([chunkId00]),
      );
    });
  });
});
