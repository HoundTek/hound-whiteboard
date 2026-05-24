import { jest } from "@jest/globals";
import { MockChunkBlockLoader } from "./chunk-block-loader.mock.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Chunk } from "../../chunk.js";
import { ChunkObjectManager } from "../../chunk-object-manager.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";
import { Vector } from "../../../utils/math.js";
import { oneChunkData } from "./data.js";

jest.unstable_mockModule("../../chunk-block-loader.js", () => ({
  ChunkBlockLoader: MockChunkBlockLoader,
}));

const { ActiveObjectManager, Layer } = await import("../../active-object-manager.js");

describe("ActiveObjectManager/operate", () => {
  let aom = new ActiveObjectManager();
  let chunk = createChunk(1);

  function createChunk(id) {
    const chunk = Chunk.fromId(id);
    chunk.isLoad = true;
    chunk.isTempLoad = false;
    return chunk;
  }

  function createObject(id, chunkId) {
    const object = new StrokeObject(new Vector(0, 0), id, chunkId);
    object.setPathPoints([new Vector(1, 1), new Vector(2, 2)]);
    return object;
  }

  function createBoard(...chunks) {
    const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    return {
      width: 10,
      height: 10,
      createChunkBlockLoader: () => new MockChunkBlockLoader(),
      getChunkById: (chunkId) => chunkMap.get(chunkId),
    };
  }

  beforeEach(() => {
    chunk = createChunk(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);
    aom = new ActiveObjectManager(createBoard(chunk));
  });

  describe("置顶选择对象", () => {
    test("应正确置顶选择对象", () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object5 = createObject(5, chunk.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 置顶 5
      aom.liftup(new Set([object5]));

      const expectedActiveSet = [new Set([12, 13]), new Set(), new Set([5])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [4, []],
          [6, []],
        ]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
        DirectedGraph.parse([]),
      ];

      expect(aom.layerOrder.length).toBe(3);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应正确置顶多个对象", () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object5 = createObject(5, chunk.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 置顶 5, 13
      aom.liftup(new Set([object5, object13]));

      const expectedActiveSet = [
        new Set([12]),
        new Set(),
        new Set([13]),
        new Set([5]),
      ];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [4, []],
          [6, []],
        ]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
        DirectedGraph.parse([]),
        DirectedGraph.parse([]),
      ];

      expect(aom.layerOrder.length).toBe(4);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });
  });

  describe("取消选择对象", () => {
    test("应正确取消选择单个对象", () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object5 = createObject(5, chunk.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 取消选择 5
      aom.apply(new Set([object5]));

      const expectedActiveSet = [new Set([12, 13]), new Set()];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [4, []],
          [6, []],
        ]),
        DirectedGraph.parse([
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

    test("应正确取消选择多个对象 #1", () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object5 = createObject(5, chunk.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 取消选择 5, 13
      aom.apply(new Set([object5, object13]));

      const expectedActiveSet = [new Set([12]), new Set()];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [4, []],
          [6, []],
        ]),
        DirectedGraph.parse([
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

    test("应正确取消选择多个对象 #2", () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object5 = createObject(5, chunk.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 取消选择 12, 13
      aom.apply(new Set([object12, object13]));

      const expectedActiveSet = [new Set([5])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(1);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });
  });

  describe("清理动态图", () => {
    test("应能正确去除空层", () => {
      const object12 = createObject(12, chunk.id);
      const object7 = createObject(7, chunk.id);
      const object8 = createObject(8, chunk.id);
      const object4 = createObject(4, chunk.id);
      const object5 = createObject(5, chunk.id);
      // 选 12, 7, 8, 4, 5
      aom.choose(
        new Set([
          object12,
          object7,
          object8,
          object4,
          object5,
        ]),
      );
      // 置顶 7, 8
      aom.liftup(new Set([object7, object8]));
      const expectedActiveSet = [
        new Set([12]),
        new Set([4, 5]),
        new Set([7, 8]),
      ];
      const expectedInactiveGraph = [
        DirectedGraph.parse([]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
        DirectedGraph.parse([]),
      ];

      expect(aom.layerOrder.length).toBe(3);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应能正确去除不能被活动对象到达的层", () => {
      const object12 = createObject(12, chunk.id);
      const object13 = createObject(13, chunk.id);
      const object5 = createObject(5, chunk.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 置顶 12, 13
      aom.liftup(new Set([object12, object13]));

      const expectedActiveSet = [new Set([5]), new Set([12, 13])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
        DirectedGraph.parse([]),
      ];

      expect(aom.layerOrder.length).toBe(2);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应在清理前缀不可达层时移除 stale onLayer 和 layerIndex", () => {
      const removedLayer = new Layer(1000);
      removedLayer.inactiveGraph.addNodeUnsafe(1);
      removedLayer.inactiveGraph.addNodeUnsafe(2);
      const keptLayer = new Layer(2000);
      keptLayer.activeObjects.add(3);

      aom.layerOrder = [removedLayer, keptLayer];
      aom.layerIndex.set(1000, 0);
      aom.layerIndex.set(2000, 1);
      aom.onLayer.set(1, removedLayer);
      aom.onLayer.set(2, removedLayer);
      aom.onLayer.set(3, keptLayer);

      aom.tidyup();

      expect(aom.layerOrder).toEqual([keptLayer]);
      expect(aom.onLayer.has(1)).toBe(false);
      expect(aom.onLayer.has(2)).toBe(false);
      expect(aom.onLayer.has(3)).toBe(true);
      expect(aom.layerIndex.size).toBe(1);
      expect(aom.layerIndex.has(1000)).toBe(false);
      expect(aom.layerIndex.get(2000)).toBe(0);
    });

    test("应释放被移除层的 layerPool id", () => {
      const removedLayerId = aom.layerPool.generate();
      const removedLayer = new Layer(removedLayerId);
      const keptLayerId = aom.layerPool.generate();
      const keptLayer = new Layer(keptLayerId);
      keptLayer.activeObjects.add(3);

      aom.layerOrder = [removedLayer, keptLayer];
      aom.layerIndex.set(removedLayerId, 0);
      aom.layerIndex.set(keptLayerId, 1);
      aom.onLayer.set(3, keptLayer);

      expect(aom.layerPool.include(removedLayerId)).toBe(true);
      expect(aom.layerPool.include(keptLayerId)).toBe(true);

      aom.tidyup();

      expect(aom.layerOrder).toEqual([keptLayer]);
      expect(aom.layerPool.include(removedLayerId)).toBe(false);
      expect(aom.layerPool.include(keptLayerId)).toBe(true);
      expect(aom.layerIndex.get(keptLayerId)).toBe(0);
    });
  });
});
