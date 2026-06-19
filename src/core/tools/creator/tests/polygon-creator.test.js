import { PolygonCreatorTool } from "../polygon-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board } from "../../../components/board.js";
import { Monitor } from "../../../components/monitor.js";
import { ChunkObjectManager } from "../../../components/chunk-object-manager.js";
import { OBJECT_CREATOR_SIGNAL_TYPES } from "../obj-creator.js";
import { createNoopCanvas } from "../../../test-support/noop-canvas.js";
import { createMouseDevice } from "../../../devices/mouse-device.js";
import { jest } from "@jest/globals";

describe("PolygonCreatorTool", () => {
  test("PolygonCreatorTool 应在同一手势内更新当前顶点，并在 end 时固化", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { acc: { objectId: 10, ownerChunkId: 1 } };

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "position", context: { value: new Vector(8, 9) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [
            { type: "position", context: { value: new Vector(10, 12) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.obj.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 5, y: 7 }]);
    expect(tool.obj.position.serialize()).toEqual({ x: 5, y: 5 });
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("构造参数应允许通过 property 指定新建多边形属性", () => {
    const tool = new PolygonCreatorTool({
      property: {
        fillColor: "#ff0000",
        strokeColor: "#0000ff",
        strokeWidth: 3,
      },
    });

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
      },
      { acc: { objectId: 99, ownerChunkId: 1 } },
    );

    expect(tool.obj.property).toMatchObject({
      fillColor: "#ff0000",
      strokeColor: "#0000ff",
      strokeWidth: 3,
    });
  });

  test("cancel 信号应重置当前手势", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { acc: { objectId: 10, ownerChunkId: 1 } };

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [
            { type: "position", context: { value: new Vector(5, 5) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.count).toBe(1);

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "cancel", context: {} }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.obj.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 0, y: 0 }]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-cancel 信号应取消整个多边形对象并撤销 AOM 注册", () => {
    const tool = new PolygonCreatorTool();
    const board = {
      activeObjectManager: { add: jest.fn(), discard: jest.fn() },
    };
    const deviceContext = { acc: { board, objectId: 10, ownerChunkId: 1 } };

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [
            { type: "position", context: { value: new Vector(5, 5) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "object-cancel", context: {} }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(board.activeObjectManager.discard).toHaveBeenCalledWith(
      new Set([expect.anything()]),
    );
    expect(tool.obj).toBeNull();
    expect(tool.count).toBe(0);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-end 信号应固化整个多边形对象", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { acc: { objectId: 10, ownerChunkId: 1 } };

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [
            { type: "position", context: { value: new Vector(5, 5) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "object-end", context: {} }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.obj.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 0, y: 0 }]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-end 后应将对象交给 activeObjectManager.apply", () => {
    const tool = new PolygonCreatorTool();
    const board = {
      addObject: jest.fn(),
      activeObjectManager: { apply: jest.fn() },
    };

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          {
            type: OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
            context: { value: new Vector(5, 5) },
          },
          { type: OBJECT_CREATOR_SIGNAL_TYPES.END, context: {} },
        ],
      },
      { acc: { board, objectId: 10, ownerChunkId: 1 } },
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      { acc: { board, objectId: 10, ownerChunkId: 1 } },
    );

    expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
      new Set([createdObject]),
    );
    expect(board.addObject).not.toHaveBeenCalled();
  });

  test("顶点更新前后应记录旧几何快照并请求活动层刷新", () => {
    const tool = new PolygonCreatorTool();
    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          {
            type: OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
            context: { value: new Vector(5, 5) },
          },
        ],
      },
      { acc: { monitor, objectId: 31, ownerChunkId: 1 } },
    );

    monitor.liveRenderer.captureObjectSnapshot.mockClear();
    monitor.liveRenderer.invalidateObjects.mockClear();
    monitor.requestViewportUiRender.mockClear();

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          {
            type: OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
            context: { value: new Vector(8, 9) },
          },
        ],
      },
      { acc: { monitor, objectId: 31, ownerChunkId: 1 } },
    );

    // 后续 update 不再重复抓取初始快照（仅在 begin 时抓一次）
    expect(monitor.liveRenderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledWith([
      tool.obj,
    ]);

    expect(monitor.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("真实 Board 上 object-end 后应经由 AOM.apply 落回归属区块", () => {
    const tool = new PolygonCreatorTool();
    const board = new Board();
    board.width = 10;
    board.height = 10;
    board.getChunkById(1).objectManager = new ChunkObjectManager(1);

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          {
            type: OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
            context: { value: new Vector(5, 5) },
          },
          { type: OBJECT_CREATOR_SIGNAL_TYPES.END, context: {} },
        ],
      },
      { acc: { board, objectId: 23, ownerChunkId: 1 } },
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      { acc: { board, objectId: 23, ownerChunkId: 1 } },
    );

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerChunk.objectManager.getObject(23)).toBe(createdObject);
  });

  describe("端到端集成（通过 Board 输入链路）", () => {
    test("挂载后的 PolygonCreatorTool 应可经由输入链路完成 object-end 提交", () => {
      const board = new Board();
      const monitor = new Monitor(
        createNoopCanvas(),
        board,
        { width: 800, height: 600 },
        "main",
      );
      board.monitors.set("main", monitor);
      board.width = 800;
      board.height = 600;
      const tool = new PolygonCreatorTool();
      monitor.origin = new Vector(100, 50);
      monitor.zoom = 2;

      monitor.mountSubDAG("", createMouseDevice());
      board.signalsEventBus.emit("mount", {
        monitorId: "main",
        name: "primary-polygon",
        workflow: tool,
        edges: [{ from: "/mouse/primary", edge: "default" }],
      });

      board.signalsEventBus.emit("input", {
        to: "/main/mouse/primary",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(125, 80),
            },
          },
          {
            type: "end",
            context: {},
          },
        ],
      });

      board.signalsEventBus.emit("input", {
        to: "/main/mouse/primary",
        signals: [
          {
            type: "object-end",
            context: {},
          },
        ],
      });

      const ownerChunk = board.getChunkById(1);
      expect(board.activeObjectManager.activeObjects.size).toBe(0);
      expect(tool.obj.id).toBe(1);
      expect(board.objectCounterPool.counter).toBe(1);
      expect(ownerChunk.objectManager.getObject(tool.obj.id)).toBe(tool.obj);
      expect(tool.obj.position.serialize()).toEqual({ x: 125, y: 80 });
      expect(
        tool.obj.localPolygonRange.points.map((point) => point.serialize()),
      ).toEqual([{ x: 0, y: 0 }]);
    });
  });
});
