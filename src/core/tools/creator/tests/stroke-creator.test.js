import { StrokeCreatorTool } from "../stroke-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board } from "../../../components/board.js";
import { ChunkObjectManager } from "../../../components/chunk-object-manager.js";
import { jest } from "@jest/globals";

describe("StrokeCreatorTool", () => {
  test("StrokeCreatorTool 应消费 position/end 信号并累计点列", () => {
    const tool = new StrokeCreatorTool();
    const deviceContext = { objectId: 100, ownerChunkId: 2 };

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [
            { type: "position", context: { value: new Vector(3, 4) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.obj.id).toBe(100);
    expect(tool.obj.ownerChunkId).toBe(2);
    expect(tool.obj.position.serialize()).toEqual({ x: 1, y: 2 });
    expect(tool.obj.localPathRange.points.map((point) => point.serialize())).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ]);
  });

  test("单 end 信号应能被正确处理", () => {
    const tool = new StrokeCreatorTool();
    const deviceContext = { objectId: 101, ownerChunkId: 3 };

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "end", context: {} }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.obj.id).toBe(101);
    expect(tool.obj.ownerChunkId).toBe(3);
    expect(tool.obj.position.serialize()).toEqual({ x: 5, y: 6 });
    expect(tool.obj.localPathRange.points.map((point) => point.serialize())).toEqual([
      { x: 0, y: 0 },
    ]);
  });

  test("cancel 信号应重置正在创建的对象并撤销 AOM 注册", () => {
    const tool = new StrokeCreatorTool();
    const board = {
      activeObjectManager: { discard: jest.fn() },
    };

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        { objectId: 1, ownerChunkId: 1, board },
      ),
    ).toBeUndefined();

    const activeObject = tool.obj;

    expect(
      tool.process({
        to: "/monitor/stroke",
        signals: [{ type: "cancel", context: {} }],
      }, { board }),
    ).toBeUndefined();

    expect(board.activeObjectManager.discard).toHaveBeenCalledWith(
      new Set([activeObject]),
    );
    expect(tool.obj).toBeNull();
  });

  test("创建完成后应将对象交给 activeObjectManager.apply", () => {
    const tool = new StrokeCreatorTool();
    const board = {
      addObject: jest.fn(),
      activeObjectManager: { apply: jest.fn() },
    };

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { objectId: 5, ownerChunkId: 1, board },
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { objectId: 5, ownerChunkId: 1, board },
    );

    expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
      new Set([createdObject]),
    );
    expect(board.addObject).not.toHaveBeenCalled();
  });

  test("首次创建对象时应注册到 activeObjectManager.add", () => {
    const tool = new StrokeCreatorTool();
    const board = {
      activeObjectManager: { add: jest.fn() },
    };

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { objectId: 9, ownerChunkId: 1, board },
    );

    expect(board.activeObjectManager.add).toHaveBeenCalledWith(
      new Set([tool.obj]),
    );
  });

  test("真实 Board 上创建完成后应经由 AOM.apply 落回归属区块", () => {
    const tool = new StrokeCreatorTool();
    const board = new Board();
    board.width = 10;
    board.height = 10;
    board.getChunkById(1).objectManager = new ChunkObjectManager(1);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { objectId: 21, ownerChunkId: 1, board },
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { objectId: 21, ownerChunkId: 1, board },
    );

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerChunk.objectManager.chunkObjects.get(21)).toBe(createdObject);
  });

  test("真实 Board 上取消创建后不应写回区块静态结构", () => {
    const tool = new StrokeCreatorTool();
    const board = new Board();
    board.width = 10;
    board.height = 10;
    board.getChunkById(1).objectManager = new ChunkObjectManager(1);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { objectId: 22, ownerChunkId: 1, board },
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "cancel", context: {} }],
      },
      { objectId: 22, ownerChunkId: 1, board },
    );

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerChunk.objectManager.chunkObjects.has(22)).toBe(false);
  });
});
