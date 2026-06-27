import { jest } from "@jest/globals";
import { createChunk } from "../../../../test-support/aom-fixtures.js";
import { DirectedGraph } from "../../../../utils/directed-graph.js";
import { Vector } from "../../../../utils/math.js";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { ChunkObjectManager } from "../../../chunk/chunk-object-manager.js";
import { StrokeObject } from "../../../../objects/stroke/stroke.js";
import { CircleObject } from "../../../../objects/graph/circle.js";
import { RectangleRange } from "../../../../range/index.js";
import { oneChunkData } from "./data.js";

describe("ActiveObjectManager/remove", () => {
  describe("基础删除", () => {
    test("remove 应将对象从区块静态图中移除", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[101, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(101, new Set([1]));

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
      };
      const aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 101, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      aom.remove(new Set([stroke]));

      expect(ownerChunk.objectManager.staticGraph.hasNode(101)).toBe(false);
      expect(ownerChunk.objectManager.getObjectCoverChunks(101)).toEqual(
        new Set(),
      );
    });

    test("remove 应从所有覆盖区块中移除对象", () => {
      // 使用螺旋 id：(0,0)=1, (1,0)=2, (1,1)=3
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[102, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(102, new Set([1, 2, 3]));

      const coveredChunkA = createChunk(2);
      coveredChunkA.objectManager = new ChunkObjectManager(2);
      coveredChunkA.objectManager.staticGraph = DirectedGraph.parse([
        [102, []],
      ]);
      coveredChunkA.objectManager.setObjectCoverChunks(102, new Set([1, 2, 3]));

      const coveredChunkB = createChunk(3);
      coveredChunkB.objectManager = new ChunkObjectManager(3);
      coveredChunkB.objectManager.staticGraph = DirectedGraph.parse([
        [102, []],
      ]);
      coveredChunkB.objectManager.setObjectCoverChunks(102, new Set([1, 2, 3]));

      const board = {
        width: 5, // 小尺寸确保横跨多个区块
        height: 5,
        getChunkById: jest.fn((chunkId) => {
          if (chunkId === 1) return ownerChunk;
          if (chunkId === 2) return coveredChunkA;
          if (chunkId === 3) return coveredChunkB;
          return undefined;
        }),
      };
      const aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 102, 1);
      // 覆盖从 (0,0) 到 (6,6)，在 5x5 的区块尺寸下会跨区块 (0,0)=1, (1,0)=2, (1,1)=3
      stroke.setPathPoints([new Vector(1, 1), new Vector(6, 6)]);

      aom.remove(new Set([stroke]));

      expect(ownerChunk.objectManager.staticGraph.hasNode(102)).toBe(false);
      expect(ownerChunk.objectManager.getObjectCoverChunks(102)).toEqual(
        new Set(),
      );
      expect(coveredChunkA.objectManager.staticGraph.hasNode(102)).toBe(false);
      expect(coveredChunkA.objectManager.getObjectCoverChunks(102)).toEqual(
        new Set(),
      );
      expect(coveredChunkB.objectManager.staticGraph.hasNode(102)).toBe(false);
      expect(coveredChunkB.objectManager.getObjectCoverChunks(102)).toEqual(
        new Set(),
      );
    });

    test("remove 应将对象从活动集合中移除", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);
      ownerChunk.objectManager.setObjectCoverChunks(12, new Set([1]));

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board);

      const stroke12 = new StrokeObject(new Vector(0, 0), 12, 1);
      stroke12.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);
      const stroke13 = new StrokeObject(new Vector(0, 0), 13, 1);
      stroke13.setPathPoints([new Vector(2, 2), new Vector(5, 5)]);

      aom.choose(new Set([stroke12, stroke13]));
      aom.remove(new Set([stroke12]));

      expect(aom.activeObjects.has(stroke12)).toBe(false);
      expect(aom.activeObjectIndex.has(12)).toBe(false);
      expect(aom.onLayer.has(12)).toBe(false);
      // stroke13 不应对 stroke12 的删除有任何影响
      expect(aom.activeObjects.has(stroke13)).toBe(true);
      expect(aom.activeObjectIndex.has(13)).toBe(true);
      expect(aom.onLayer.has(13)).toBe(true);
    });

    test("remove 应能处理不在活动集合中的对象", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[201, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(201, new Set([1]));

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
      };
      const aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 201, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      // 对象不在活动集合中，仅存在于静态图
      aom.remove(new Set([stroke]));

      expect(ownerChunk.objectManager.staticGraph.hasNode(201)).toBe(false);
      expect(ownerChunk.objectManager.getObjectCoverChunks(201)).toEqual(
        new Set(),
      );
      expect(aom.activeObjects.size).toBe(0);
    });

    test("remove 应清理所有被移除对象后的空层", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);
      for (const nodeId of [12, 13, 5, 7, 8, 9, 4, 6]) {
        ownerChunk.objectManager.setObjectCoverChunks(nodeId, new Set([1]));
      }

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board);

      const objects = new Map();
      for (const nodeId of [12, 13, 5]) {
        const obj = new StrokeObject(new Vector(0, 0), nodeId, 1);
        obj.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);
        objects.set(nodeId, obj);
      }

      // select 12, 13, 5 会创建多层
      aom.choose(new Set([objects.get(12), objects.get(13), objects.get(5)]));
      expect(aom.layerOrder.length).toBeGreaterThanOrEqual(2);

      // 移除全部活动对象
      aom.remove(new Set([objects.get(12), objects.get(13), objects.get(5)]));

      // 空层应被 tidyup 清理
      expect(aom.layerOrder.length).toBe(0);
      expect(aom.activeObjects.size).toBe(0);
      expect(aom.activeObjectIndex.size).toBe(0);
      expect(aom.onLayer.size).toBe(0);
    });
  });

  describe("渲染触发", () => {
    test("remove 应通过 renderHooks 触发 live 层刷新", () => {
      const requestLiveRender = jest.fn();
      const requestBaseRenderForObjects = jest.fn();
      const renderHooks = {
        requestLiveRender,
        requestBaseRender: jest.fn(),
        requestBaseRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[301, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(301, new Set([1]));

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board, { renderHooks });

      const stroke = new StrokeObject(new Vector(0, 0), 301, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      requestLiveRender.mockClear();
      requestBaseRenderForObjects.mockClear();

      aom.remove(new Set([stroke]));

      expect(requestLiveRender).toHaveBeenCalledTimes(1);
      expect(requestLiveRender).toHaveBeenCalledWith([stroke]);
    });

    test("remove 应通过 renderHooks 触发 base 层区块级渲染请求", () => {
      const requestBaseRenderForObjects = jest.fn();
      const renderHooks = {
        requestLiveRender: jest.fn(),
        requestBaseRender: jest.fn(),
        requestBaseRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[302, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(302, new Set([1, 2]));

      const coveredChunk = createChunk(2);
      coveredChunk.objectManager = new ChunkObjectManager(2);
      coveredChunk.objectManager.staticGraph = DirectedGraph.parse([[302, []]]);
      coveredChunk.objectManager.setObjectCoverChunks(302, new Set([1, 2]));

      const board = {
        width: 10,
        height: 10,
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

      const stroke = new StrokeObject(new Vector(0, 0), 302, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(15, 15)]);

      aom.remove(new Set([stroke]));

      expect(requestBaseRenderForObjects).toHaveBeenCalledTimes(1);
    });

    test("remove 应优先触发对象级静态层局部失效", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[303, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(303, new Set([1]));

      const requestBaseRenderForObjects = jest.fn();
      const renderHooks = {
        requestLiveRender: jest.fn(),
        requestBaseRender: jest.fn(),
        requestBaseRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board, { renderHooks });

      const stroke = new StrokeObject(new Vector(0, 0), 303, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      aom.remove(new Set([stroke]));

      expect(requestBaseRenderForObjects).toHaveBeenCalledTimes(1);
    });
  });

  describe("快照清理", () => {
    test("remove 应清理 baseObjectSnapshotWorldRanges", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[401, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(401, new Set([1]));

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 401, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      // choose 会调用 captureBaseObjectSnapshot，填充快照
      aom.choose(new Set([stroke]));
      expect(aom.baseObjectSnapshotWorldRanges.has(401)).toBe(true);
      expect(aom.baseObjectSnapshotCoverChunks.has(401)).toBe(true);

      aom.remove(new Set([stroke]));

      expect(aom.baseObjectSnapshotWorldRanges.has(401)).toBe(false);
      expect(aom.baseObjectSnapshotCoverChunks.has(401)).toBe(false);
    });

    test("remove 应清理 add 产生的快照", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[402, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(402, new Set([1]));

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
      };
      const aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 402, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      // add 不产生快照，apply 后才产生
      aom.add(new Set([stroke]));
      aom.apply(new Set([stroke]));

      // 此时快照应已由 apply 清理
      expect(aom.baseObjectSnapshotWorldRanges.has(402)).toBe(false);
      expect(aom.baseObjectSnapshotCoverChunks.has(402)).toBe(false);

      // choose 后再 remove
      aom.choose(new Set([stroke]));
      expect(aom.baseObjectSnapshotWorldRanges.has(402)).toBe(true);

      aom.remove(new Set([stroke]));
      expect(aom.baseObjectSnapshotWorldRanges.has(402)).toBe(false);
      expect(aom.baseObjectSnapshotCoverChunks.has(402)).toBe(false);
    });
  });

  describe("静态图邻接清理", () => {
    test("remove 应将邻接对象纳入 base 层失效", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([
        [501, [502]],
        [502, []],
      ]);
      ownerChunk.objectManager.setObjectCoverChunks(501, new Set([1]));
      ownerChunk.objectManager.setObjectCoverChunks(502, new Set([1]));

      const requestBaseRenderForObjects = jest.fn();
      const renderHooks = {
        requestLiveRender: jest.fn(),
        requestBaseRender: jest.fn(),
        requestBaseRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      const objectMap = new Map();
      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        getObjectById: jest.fn((objectId) => objectMap.get(objectId)),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board, { renderHooks });

      const lower = new StrokeObject(new Vector(0, 0), 501, 1);
      lower.setPathPoints([new Vector(1, 1), new Vector(7, 7)]);
      const upper = new StrokeObject(new Vector(0, 0), 502, 1);
      upper.setPathPoints([new Vector(2, 2), new Vector(8, 8)]);
      objectMap.set(501, lower);
      objectMap.set(502, upper);

      aom.remove(new Set([lower]));

      expect(requestBaseRenderForObjects).toHaveBeenCalledTimes(1);
      const [invalidatedObjects] = requestBaseRenderForObjects.mock.calls[0];
      // 被移除的对象 501 和它的邻接对象 502 都应纳入失效
      expect(
        invalidatedObjects.map((obj) => obj.id).sort((a, b) => a - b),
      ).toEqual([501, 502]);
    });

    test("remove 删除无邻接的孤立对象时只纳入自身", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([[601, []]]);
      ownerChunk.objectManager.setObjectCoverChunks(601, new Set([1]));

      const requestBaseRenderForObjects = jest.fn();
      const renderHooks = {
        requestLiveRender: jest.fn(),
        requestBaseRender: jest.fn(),
        requestBaseRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        getObjectById: jest.fn(() => undefined),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board, { renderHooks });

      const stroke = new StrokeObject(new Vector(0, 0), 601, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      aom.remove(new Set([stroke]));

      expect(requestBaseRenderForObjects).toHaveBeenCalledTimes(1);
      const [invalidatedObjects] = requestBaseRenderForObjects.mock.calls[0];
      expect(invalidatedObjects.map((obj) => obj.id)).toEqual([601]);
    });
  });

  describe("混合场景", () => {
    test("remove 应支持同时移除活动和静态对象", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);
      ownerChunk.objectManager.staticGraph = DirectedGraph.parse([
        [701, []],
        [702, []],
        [703, []],
      ]);
      ownerChunk.objectManager.setObjectCoverChunks(701, new Set([1]));
      ownerChunk.objectManager.setObjectCoverChunks(702, new Set([1]));
      ownerChunk.objectManager.setObjectCoverChunks(703, new Set([1]));

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
        createChunkLoader: jest.fn(() => ({
          trackChunk: jest.fn(),
          emitLoadRequest: jest.fn(),
        })),
      };
      const aom = new ActiveObjectManager(board);

      const activeObj = new StrokeObject(new Vector(0, 0), 701, 1);
      activeObj.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);
      const staticObjA = new StrokeObject(new Vector(0, 0), 702, 1);
      staticObjA.setPathPoints([new Vector(2, 2), new Vector(5, 5)]);
      const staticObjB = new StrokeObject(new Vector(0, 0), 703, 1);
      staticObjB.setPathPoints([new Vector(3, 3), new Vector(6, 6)]);

      // 只有 701 是活动对象
      aom.choose(new Set([activeObj]));
      expect(aom.activeObjectIndex.has(701)).toBe(true);

      aom.remove(new Set([activeObj, staticObjA, staticObjB]));

      // 所有对象都应从静态图中移除
      expect(ownerChunk.objectManager.staticGraph.hasNode(701)).toBe(false);
      expect(ownerChunk.objectManager.staticGraph.hasNode(702)).toBe(false);
      expect(ownerChunk.objectManager.staticGraph.hasNode(703)).toBe(false);
      // 活动的 701 也应从活动集合中移除
      expect(aom.activeObjectIndex.has(701)).toBe(false);
      expect(aom.activeObjects.size).toBe(0);
    });

    test("remove 应能处理由 add 加入但未 apply 的对象", () => {
      const ownerChunk = createChunk(1);
      ownerChunk.objectManager = new ChunkObjectManager(1);

      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) =>
          chunkId === 1 ? ownerChunk : undefined,
        ),
      };
      const aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 801, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      // add 将对象注册为活动对象，但未写入区块静态图
      aom.add(new Set([stroke]));
      expect(aom.activeObjectIndex.has(801)).toBe(true);

      aom.remove(new Set([stroke]));

      // 活动状态应被清理
      expect(aom.activeObjectIndex.has(801)).toBe(false);
      expect(aom.activeObjects.size).toBe(0);
      // 区块静态图中也不应在（本来就不在）
      expect(ownerChunk.objectManager.staticGraph.hasNode(801)).toBe(false);
    });

    test("remove 应用于空集合时不应抛错", () => {
      const aom = new ActiveObjectManager();

      expect(() => aom.remove(new Set([]))).not.toThrow();
      expect(() => aom.remove([])).not.toThrow();
    });

    test("remove 传入非 BasicObject 实例时应抛 TypeError", () => {
      const aom = new ActiveObjectManager();

      expect(() => aom.remove(new Set([{}]))).toThrow(TypeError);
      expect(() => aom.remove(new Set([42]))).toThrow(TypeError);
      expect(() => aom.remove(new Set(["not-an-object"]))).toThrow(TypeError);
    });

    test("remove 应能处理无 board 挂载的 AOM", () => {
      const aom = new ActiveObjectManager();

      const stroke = new StrokeObject(new Vector(0, 0), 901, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      // 无 board 时仅从活动集合中移除
      aom.add(new Set([stroke]));
      expect(aom.activeObjectIndex.has(901)).toBe(true);

      expect(() => aom.remove(new Set([stroke]))).not.toThrow();

      expect(aom.activeObjectIndex.has(901)).toBe(false);
      expect(aom.activeObjects.size).toBe(0);
    });
  });

  describe("跨区块删除", () => {
    test("remove 应能从多个区块中正确移除跨区块对象", () => {
      // 螺旋 id：(0,0)=1, (1,0)=2, (2,0)=11
      const chunk00 = createChunk(1);
      chunk00.objectManager = new ChunkObjectManager(1);
      chunk00.objectManager.staticGraph = DirectedGraph.parse([[1001, []]]);
      chunk00.objectManager.setObjectCoverChunks(1001, new Set([1, 2, 11]));

      const chunk10 = createChunk(2);
      chunk10.objectManager = new ChunkObjectManager(2);
      chunk10.objectManager.staticGraph = DirectedGraph.parse([[1001, []]]);
      chunk10.objectManager.setObjectCoverChunks(1001, new Set([1, 2, 11]));

      const chunk20 = createChunk(11);
      chunk20.objectManager = new ChunkObjectManager(11);
      chunk20.objectManager.staticGraph = DirectedGraph.parse([[1001, []]]);
      chunk20.objectManager.setObjectCoverChunks(1001, new Set([1, 2, 11]));

      const board = {
        width: 10, // 覆盖 (0,0), (1,0), (2,0) 三个区块
        height: 10,
        getChunkById: jest.fn((chunkId) => {
          if (chunkId === 1) return chunk00;
          if (chunkId === 2) return chunk10;
          if (chunkId === 11) return chunk20;
          return undefined;
        }),
      };
      const aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 1001, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(25, 4)]);

      aom.remove(new Set([stroke]));

      expect(chunk00.objectManager.staticGraph.hasNode(1001)).toBe(false);
      expect(chunk00.objectManager.getObjectCoverChunks(1001)).toEqual(
        new Set(),
      );
      expect(chunk10.objectManager.staticGraph.hasNode(1001)).toBe(false);
      expect(chunk10.objectManager.getObjectCoverChunks(1001)).toEqual(
        new Set(),
      );
      expect(chunk20.objectManager.staticGraph.hasNode(1001)).toBe(false);
      expect(chunk20.objectManager.getObjectCoverChunks(1001)).toEqual(
        new Set(),
      );
    });

    test("remove 应正确处理部分区块不存在的场景", () => {
      const chunk00 = createChunk(1);
      chunk00.objectManager = new ChunkObjectManager(1);
      chunk00.objectManager.staticGraph = DirectedGraph.parse([[1101, []]]);
      chunk00.objectManager.setObjectCoverChunks(1101, new Set([1, 2]));

      // 区块 2 不存在
      const board = {
        width: 10,
        height: 10,
        getChunkById: jest.fn((chunkId) => {
          if (chunkId === 1) return chunk00;
          return undefined;
        }),
      };
      const aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 1101, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(15, 15)]);

      expect(() => aom.remove(new Set([stroke]))).not.toThrow();
      expect(chunk00.objectManager.staticGraph.hasNode(1101)).toBe(false);
    });
  });
});
