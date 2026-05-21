import { jest } from "@jest/globals";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Vector } from "../../../utils/math.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { Board } from "../../board.js";
import { Chunk } from "../../chunk.js";
import { ChunkObjectManager } from "../../chunk-object-manager.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";
import { MockChunkLoader } from "./chunk-loader.mock.js";
import { oneChunkData } from "./data.js";

describe("ActiveObjectManager/apply", () => {
  function createChunk(id) {
    const chunk = Chunk.fromId(id);
    chunk.isLoad = true;
    chunk.isTempLoad = false;
    return chunk;
  }

  test("pickup 应优先使用 Board.createChunkLoader 且不再要求 Chunk 入参", () => {
    const chunk = createChunk(1);
    chunk.objectManager = new ChunkObjectManager(1);
    chunk.objectManager.staticGraph = DirectedGraph.parse(oneChunkData);

    const board = {
      createChunkLoader: jest.fn(() => new MockChunkLoader()),
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

    expect(board.createChunkLoader).toHaveBeenCalled();
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
    expect(ownerChunk.objectManager.chunkObjects.get(15)).toBe(stroke);
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
});
