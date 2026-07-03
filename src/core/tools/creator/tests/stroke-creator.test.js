import { jest } from "@jest/globals";
import { StrokeCreatorTool } from "../stroke-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board, Monitor } from "../../../components/index.js";
import { ChunkObjectManager } from "../../../components/chunk/chunk-object-manager.js";
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

describe("StrokeCreatorTool", () => {
  test("StrokeCreatorTool 应消费 position/end 信号并累计点列", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(100);

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

    expect(tool._local.id).toBe(100);
    expect(tool._local.position.serialize()).toEqual({ x: 1, y: 2 });
    expect(
      tool._local.data.points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test("连续重复位置不应产生重复路径点", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(200);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [
          { type: "position", context: { value: new Vector(2, 3) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(
      tool._local.data.points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  test("单 end 信号应能被正确处理", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(101);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(tool._local.id).toBe(101);
    expect(tool._local.position.serialize()).toEqual({ x: 5, y: 6 });
    expect(
      tool._local.data.points,
    ).toEqual([{ x: 0, y: 0 }]);
  });

  test("构造参数应允许通过 property 指定新建笔画属性", () => {
    const tool = new StrokeCreatorTool({
      property: { color: "#ff0000", width: 4 },
    });
    const { deviceContext } = createBoardDeviceContext(102);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
      },
      deviceContext,
    );

    expect(tool._local.property).toMatchObject({ color: "#ff0000", width: 4 });
  });

  test("cancel 信号应重置正在创建的对象并撤销 transient 对象", () => {
    const tool = new StrokeCreatorTool();
    const { board, boardApi, deviceContext } = createBoardDeviceContext(1);
    const discardSpy = jest.spyOn(boardApi, "discardActiveObjects");

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "cancel", context: {} }],
      },
      { acc: { board, boardApi, objectId: 1, ownerChunkId: 1 } },
    );

    expect(discardSpy).toHaveBeenCalledWith([1]);
    expect(tool._local).toBeNull();
    expect(board.getObjectById(1)).toBeUndefined();
  });

  test("首次创建对象时应进入 activeObjectManager 并写回上下文", () => {
    const tool = new StrokeCreatorTool();
    const { board, deviceContext } = createBoardDeviceContext(9);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    expect(board.activeObjectManager.activeObjects.size).toBe(1);
    expect(deviceContext.acc.objects).toEqual([tool._local]);
  });

  test("显式提供 boardApi 时应通过 appendListItem 累计路径点并在 end 后提交", () => {
    const tool = new StrokeCreatorTool();
    const { board, boardApi, deviceContext } = createBoardDeviceContext(20);
    const createSpy = jest.spyOn(boardApi, "createObject");
    const appendSpy = jest.spyOn(boardApi, "appendListItem");
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [
          { type: "position", context: { value: new Vector(3, 4) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(createSpy).toHaveBeenCalledWith(
      "StrokeObject",
      expect.objectContaining({
        id: 20,
        position: new Vector(1, 2),
      }),
    );
    expect(appendSpy).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalledWith([20]);
    expect(
      board
        .getChunkById(1)
        .objectManager.getObject(20)
        .data.points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test("RPC 风格 boardApi 下应维护本地草稿路径点并提交", () => {
    const tool = new StrokeCreatorTool();
    const board = {
      allocateObjectId: jest.fn(() => 701),
    };
    const boardApi = {
      createObject: jest.fn(),
      appendListItem: jest.fn(),
      commitObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const deviceContext = {
      acc: {
        board,
        boardApi,
      },
    };

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(3, 4) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.createObject).toHaveBeenCalledWith(
      "StrokeObject",
      expect.objectContaining({
        id: 701,
        position: new Vector(1, 2),
      }),
    );
    expect(boardApi.appendListItem).toHaveBeenCalled();
    expect(boardApi.commitObjects).toHaveBeenCalledWith([701]);
    expect(
      tool._local.data.points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test("创建手势更新后仅请求 UI overlay 刷新，不再直调 liveRenderer", () => {
    const tool = new StrokeCreatorTool();
    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const { deviceContext } = createBoardDeviceContext(30, { monitor });

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    monitor.liveRenderer.captureObjectSnapshot.mockClear();
    monitor.liveRenderer.invalidateObjects.mockClear();
    monitor.requestViewportUiRender.mockClear();

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    expect(monitor.liveRenderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(monitor.liveRenderer.invalidateObjects).not.toHaveBeenCalled();
    expect(monitor.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("真实 Board 上创建完成后应写回归属区块", () => {
    const tool = new StrokeCreatorTool();
    const { board, deviceContext } = createBoardDeviceContext(21);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    const createdObject = tool._local;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    const ownerChunk = board.getChunkById(1);
    const committedObject = ownerChunk.objectManager.getObject(21);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(committedObject).not.toBe(createdObject);
    expect(committedObject).toMatchObject({
      id: createdObject.id,
      position: { x: createdObject.position.x, y: createdObject.position.y },
      property: createdObject.property,
      data: createdObject.data,
    });
  });

  test("真实 Board 上取消创建后不应写回区块静态结构", () => {
    const tool = new StrokeCreatorTool();
    const { board, deviceContext } = createBoardDeviceContext(22);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "cancel", context: {} }],
      },
      deviceContext,
    );

    const ownerChunk = board.getChunkById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerChunk.objectManager.getObject(22)).toBeUndefined();
    expect(board.getObjectById(22)).toBeUndefined();
  });

  test("连续两次创建应生成两个不同笔画对象", () => {
    const tool = new StrokeCreatorTool();
    const { board, boardApi } = createBoardDeviceContext(31);

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { acc: { board, boardApi, objectId: 31, ownerChunkId: 1 } },
    );

    const firstObject = tool._local;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { acc: { board, boardApi, objectId: 31, ownerChunkId: 1 } },
    );

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(4, 5) } }],
      },
      { acc: { board, boardApi, objectId: 32, ownerChunkId: 1 } },
    );

    const secondObject = tool._local;

    tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { acc: { board, boardApi, objectId: 32, ownerChunkId: 1 } },
    );

    const ownerChunk = board.getChunkById(1);
    const firstCommittedObject = ownerChunk.objectManager.getObject(31);
    const secondCommittedObject = ownerChunk.objectManager.getObject(32);
    expect(firstObject).not.toBe(secondObject);
    expect(firstObject.id).toBe(31);
    expect(secondObject.id).toBe(32);
    expect(firstCommittedObject).not.toBe(firstObject);
    expect(secondCommittedObject).not.toBe(secondObject);
    expect(firstCommittedObject).toMatchObject({
      id: firstObject.id,
      position: { x: firstObject.position.x, y: firstObject.position.y },
      property: firstObject.property,
      data: firstObject.data,
    });
    expect(secondCommittedObject).toMatchObject({
      id: secondObject.id,
      position: { x: secondObject.position.x, y: secondObject.position.y },
      property: secondObject.property,
      data: secondObject.data,
    });
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
  });

  describe("端到端集成（通过 Board 输入链路）", () => {
    test("挂载后的 StrokeCreatorTool 应可经由 Board 输入链路创建对象并提交到白板", () => {
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
      const tool = new StrokeCreatorTool();
      monitor.origin = new Vector(100, 50);
      monitor.zoom = 2;

      monitor.mountSubDAG("", createMouseDevice());
      board.signalsEventBus.emit("mount", {
        monitorId: "main",
        name: "primary-stroke",
        workflow: tool,
        edges: [{ from: "/mouse/primary", edge: "default" }],
      });

      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(105, 60),
              buttons: 1,
              button: 0,
            },
          },
        ],
      });

      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(110, 65),
              buttons: 1,
              button: 0,
            },
          },
        ],
      });

      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "end",
            context: {
              buttons: 0,
              button: 0,
            },
          },
        ],
      });

      const ownerChunk = board.getChunkById(1);
      const committedObject = ownerChunk.objectManager.getObject(tool._local.id);
      expect(board.activeObjectManager.activeObjects.size).toBe(0);
      expect(tool._local.id).toBe(1);
      expect(board.objectCounterPool.counter).toBe(1);
      expect(committedObject).not.toBe(tool._local);
      expect(committedObject).toMatchObject({
        id: tool._local.id,
        position: { x: tool._local.position.x, y: tool._local.position.y },
        property: tool._local.property,
        data: tool._local.data,
      });
      expect(tool._local.position.serialize()).toEqual({ x: 105, y: 60 });
      expect(
        tool._local.data.points,
      ).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]);
    });

    test("挂载后的 StrokeCreatorTool 在绘制中应将对象加入 activeObjectManager 层", () => {
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
      const tool = new StrokeCreatorTool();
      monitor.origin = new Vector(100, 50);
      monitor.zoom = 2;

      monitor.mountSubDAG("", createMouseDevice());

      board.signalsEventBus.emit("mount", {
        monitorId: "main",
        name: "primary-stroke",
        workflow: tool,
        edges: [{ from: "/mouse/primary", edge: "default" }],
      });

      board.signalsEventBus.emit("input", {
        to: "/main/mouse",
        signals: [
          {
            type: "position",
            context: {
              value: new Vector(105, 60),
              buttons: 1,
              button: 0,
            },
          },
        ],
      });

      expect(board.activeObjectManager.activeObjects.size).toBe(1);
      expect(board.activeObjectManager.layerOrder.length).toBe(1);
      expect(
        board.activeObjectManager.layerOrder[0].activeObjects.has(tool._local.id),
      ).toBe(true);
    });
  });
});
