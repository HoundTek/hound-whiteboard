import { jest } from "@jest/globals";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Vector } from "../../../utils/math.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { Board } from "../../board.js";
import { Chunk } from "../../chunk.js";
import { ChunkObjectManager } from "../../chunk-object-manager.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";
import { MockChunkBlockLoader } from "./chunk-block-loader.mock.js";
import { oneChunkData } from "./data.js";
import { RectangleRange } from "../../../range/index.js";

describe("ActiveObjectManager/apply", () => {
  function createChunk(id) {
    const chunk = Chunk.fromId(id);
    chunk.isLoad = true;
    chunk.isTempLoad = false;
    return chunk;
  }

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

  test("add 应将白板外新对象注册到动态图顶层", () => {
    const aom = new ActiveObjectManager();
    const lower = new StrokeObject(new Vector(0, 0), 30, 1);
    lower.setPathPoints([new Vector(1, 1), new Vector(5, 5)]);
    const upper = new StrokeObject(new Vector(0, 0), 31, 1);
    upper.setPathPoints([new Vector(2, 2), new Vector(6, 6)]);

    const firstLayer = aom.add(new Set([lower]));
    const secondLayer = aom.add(new Set([upper]));

    expect(firstLayer.activeObjects).toEqual(new Set([30]));
    expect(secondLayer.activeObjects).toEqual(new Set([31]));
    expect(aom.activeObjects).toEqual(new Set([lower, upper]));
    expect(aom.layerOrder).toEqual([firstLayer, secondLayer]);
    expect(aom.onLayer.get(30)).toBe(firstLayer);
    expect(aom.onLayer.get(31)).toBe(secondLayer);
  });

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
      monitors: new Map([["main", monitor]]),
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
      monitors: new Map([["main", monitor]]),
      getObjectById: jest.fn((objectId) =>
        objectId === 301 ? stroke : undefined,
      ),
      getChunkById: jest.fn((chunkId) => (chunkId === 1 ? ownerChunk : undefined)),
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
      monitors: new Map([["main", monitor]]),
      getObjectById: jest.fn((objectId) => objectMap.get(objectId)),
      getChunkById: jest.fn((chunkId) => (chunkId === 1 ? ownerChunk : undefined)),
      createChunkBlockLoader: jest.fn(() => new MockChunkBlockLoader()),
    };
    const aom = new ActiveObjectManager(board);

    aom.choose(new Set([lower]));
    aom.liftup(new Set([lower]));
    aom.apply(new Set([lower]));

    expect(monitor.baseRenderer.invalidateObjects).toHaveBeenCalledTimes(1);
    const [invalidatedObjects] = monitor.baseRenderer.invalidateObjects.mock.calls[0];
    expect(
      invalidatedObjects.map((objectInstance) => objectInstance.id).sort((a, b) => a - b),
    ).toEqual([401, 402]);
  });
});
