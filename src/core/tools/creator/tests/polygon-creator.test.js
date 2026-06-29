import { jest } from "@jest/globals";
import { PolygonCreatorTool } from "../polygon-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board, Monitor } from "../../../components/index.js";
import { ChunkObjectManager } from "../../../components/chunk/chunk-object-manager.js";
import { OBJECT_CREATOR_SIGNAL_TYPES } from "../object-creator.js";
import { createNoopCanvas } from "../../../test-support/noop-canvas.js";
import { createMouseDevice } from "../../../devices/mouse-device.js";

function createBoardDeviceContext(objectId, { monitor } = {}) {
  const board = new Board();
  board.width = 10;
  board.height = 10;
  board.getChunkById(1).objectManager = new ChunkObjectManager(1);
  const boardApi = board.getBoardApi();

  return {
    board,
    boardApi,
    deviceContext: {
      acc: {
        board,
        boardApi,
        monitor,
        objectId,
        ownerChunkId: 1,
      },
    },
  };
}

describe("PolygonCreatorTool", () => {
  test("PolygonCreatorTool 应在同一手势内更新当前顶点，并在 end 时固化", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext(10);

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "position", context: { value: new Vector(8, 9) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: "position", context: { value: new Vector(10, 12) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(
      tool.obj.rich.localPolygonRange.points.map((point) => point.serialize()),
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
    const { deviceContext } = createBoardDeviceContext(99);

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
      },
      deviceContext,
    );

    expect(tool.obj.property).toMatchObject({
      fillColor: "#ff0000",
      strokeColor: "#0000ff",
      strokeWidth: 3,
    });
  });

  test("cancel 信号应重置当前手势", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext(10);

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: "position", context: { value: new Vector(5, 5) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool.count).toBe(1);

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "cancel", context: {} }],
      },
      deviceContext,
    );

    expect(
      tool.obj.rich.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 0, y: 0 }]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-cancel 信号应取消整个多边形对象并撤销 transient 对象", () => {
    const tool = new PolygonCreatorTool();
    const { board, boardApi, deviceContext } = createBoardDeviceContext(10);
    const discardSpy = jest.spyOn(boardApi, "discardActiveObjects");

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: "position", context: { value: new Vector(5, 5) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "object-cancel", context: {} }],
      },
      { acc: { board, boardApi, objectId: 10, ownerChunkId: 1 } },
    );

    expect(discardSpy).toHaveBeenCalledWith([10]);
    expect(tool.obj).toBeNull();
    expect(tool.count).toBe(0);
    expect(tool.lastPoint).toBeNull();
    expect(board.getObjectById(10)).toBeUndefined();
  });

  test("object-end 信号应固化整个多边形对象", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext(10);

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: "position", context: { value: new Vector(5, 5) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "object-end", context: {} }],
      },
      deviceContext,
    );

    expect(
      tool.obj.rich.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 0, y: 0 }]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-end 后应通过 boardApi.commitObjects 提交对象", () => {
    const tool = new PolygonCreatorTool();
    const { boardApi, deviceContext } = createBoardDeviceContext(10);
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

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
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      deviceContext,
    );

    expect(commitSpy).toHaveBeenCalledWith([10]);
  });

  test("顶点更新后仅请求 UI overlay 刷新，不再直调 liveRenderer", () => {
    const tool = new PolygonCreatorTool();
    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const { deviceContext } = createBoardDeviceContext(31, { monitor });

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
      deviceContext,
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
      deviceContext,
    );

    expect(monitor.liveRenderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(monitor.liveRenderer.invalidateObjects).not.toHaveBeenCalled();
    expect(monitor.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("显式提供 boardApi 时应通过 BoardApi 创建并提交多边形对象", () => {
    const tool = new PolygonCreatorTool();
    const { board, boardApi, deviceContext } = createBoardDeviceContext(24);
    const createSpy = jest.spyOn(boardApi, "createObject");
    const appendSpy = jest.spyOn(boardApi, "appendListItem");
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

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
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      deviceContext,
    );

    expect(createSpy).toHaveBeenCalledWith(
      "PolygonObject",
      expect.objectContaining({
        id: 24,
        position: new Vector(5, 5),
      }),
    );
    expect(appendSpy).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalledWith([24]);

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerChunk.objectManager.getObject(24)).toBe(tool.obj);
  });

  test("真实 Board 上 object-end 后应写回归属区块", () => {
    const tool = new PolygonCreatorTool();
    const { board, deviceContext } = createBoardDeviceContext(23);

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
      deviceContext,
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      deviceContext,
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
        tool.obj.rich.localPolygonRange.points.map((point) =>
          point.serialize(),
        ),
      ).toEqual([{ x: 0, y: 0 }]);
    });
  });
});
