import { StrokeCreatorTool } from "../stroke-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board } from "../../../components/board.js";
import { ChunkObjectManager } from "../../../components/chunk-object-manager.js";
import { jest } from "@jest/globals";

describe("StrokeCreatorTool", () => {
  test("StrokeCreatorTool 应消费 position/end 信号并累计点列", () => {
    const tool = new StrokeCreatorTool();
    const deviceContext = { context: {}, objectId: 100, ownerChunkId: 2 };

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
    expect(
      tool.obj.localPathRange.points.map((point) => point.serialize()),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test("连续重复位置不应产生重复路径点", () => {
    const tool = new StrokeCreatorTool();
    const deviceContext = { context: {}, objectId: 200, ownerChunkId: 2 };

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
            { type: "position", context: { value: new Vector(2, 3) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.obj.localPathRange.points.map((point) => point.serialize()),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  test("单 end 信号应能被正确处理", () => {
    const tool = new StrokeCreatorTool();
    const deviceContext = { context: {}, objectId: 101, ownerChunkId: 3 };

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
    expect(
      tool.obj.localPathRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 0, y: 0 }]);
  });

  test("构造参数应允许通过 property 指定新建笔画属性", () => {
    const tool = new StrokeCreatorTool({
      property: { color: "#ff0000", width: 4 },
    });

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
      },
      { context: {}, objectId: 102, ownerChunkId: 3 },
    );

    expect(tool.obj.property).toMatchObject({ color: "#ff0000", width: 4 });
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
        { context: { board }, objectId: 1, ownerChunkId: 1 },
      ),
    ).toBeUndefined();

    const activeObject = tool.obj;

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "cancel", context: {} }],
        },
        { context: { board } },
      ),
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
      { context: { board }, objectId: 5, ownerChunkId: 1 },
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { context: { board }, objectId: 5, ownerChunkId: 1 },
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

    const deviceContext = { context: { board }, objectId: 9, ownerChunkId: 1 };

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    expect(board.activeObjectManager.add).toHaveBeenCalledWith(
      new Set([tool.obj]),
    );
    expect(deviceContext.context.objects).toEqual([tool.obj]);
  });

  test("创建手势更新前后应记录旧几何快照并请求活动层刷新", () => {
    const tool = new StrokeCreatorTool();
    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { context: { monitor }, objectId: 30, ownerChunkId: 1 },
    );

    monitor.liveRenderer.captureObjectSnapshot.mockClear();
    monitor.liveRenderer.invalidateObjects.mockClear();
    monitor.requestViewportUiRender.mockClear();

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      { context: { monitor }, objectId: 30, ownerChunkId: 1 },
    );

    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledWith([
      tool.obj,
    ]);
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledWith([
      tool.obj,
    ]);
    expect(monitor.requestViewportUiRender).toHaveBeenCalledTimes(1);
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
      { context: { board }, objectId: 21, ownerChunkId: 1 },
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { context: { board }, objectId: 21, ownerChunkId: 1 },
    );

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerChunk.objectManager.getObject(21)).toBe(createdObject);
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
      { context: { board }, objectId: 22, ownerChunkId: 1 },
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "cancel", context: {} }],
      },
      { context: { board }, objectId: 22, ownerChunkId: 1 },
    );

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerChunk.objectManager.getObject(22)).toBeUndefined();
  });

  test("连续两次创建应生成两个不同笔画对象", () => {
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
      { context: { board }, objectId: 31, ownerChunkId: 1 },
    );

    const firstObject = tool.obj;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { context: { board }, objectId: 31, ownerChunkId: 1 },
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(4, 5) } }],
      },
      { context: { board }, objectId: 32, ownerChunkId: 1 },
    );

    const secondObject = tool.obj;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { context: { board }, objectId: 32, ownerChunkId: 1 },
    );

    const ownerChunk = board.getChunkById(1);
    expect(firstObject).not.toBe(secondObject);
    expect(firstObject.id).toBe(31);
    expect(secondObject.id).toBe(32);
    expect(ownerChunk.objectManager.getObject(31)).toBe(firstObject);
    expect(ownerChunk.objectManager.getObject(32)).toBe(secondObject);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
  });
});
