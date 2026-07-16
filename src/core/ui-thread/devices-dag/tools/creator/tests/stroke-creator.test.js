import { jest } from "@jest/globals";
import { StrokeCreatorTool } from "../stroke-creator.js";
import { Vector } from "../../../../../engine/utils/math.js";
import { createMouseDevice } from "../../../devices/mouse-device.js";
import {
  createWorkerBoardContext,
  flushMicrotasks,
} from "../../../../../test-support/worker-mode-fixtures.js";

function createBoardDeviceContext(objectId, { viewport } = {}) {
  const board = {
    allocateObjectId: jest.fn(() => objectId),
    getObjectById: jest.fn(() => undefined),
  };
  const boardApi = {
    createObject: jest.fn(async () => objectId),
    appendListItem: jest.fn(),
    commitObjects: jest.fn(),
    discardActiveObjects: jest.fn(),
  };

  const _nodeState = {};
  const deviceContext = {
    path: "/test",
    getNodeState: () => ({ ..._nodeState }),
    setNodeState: (_pathOrId, state) => {
      Object.assign(_nodeState, state);
      return { ..._nodeState };
    },
    _nodeState,
    acc: {
      board,
      boardApi,
      viewport,
      objectId,
      ownerChunkId: 1,
    },
  };

  return { deviceContext };
}

describe("StrokeCreatorTool", () => {
  test("StrokeCreatorTool 应消费 position/end 信号并累计点列", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(100);

    expect(
      tool.process(
        {
          to: "/viewport/stroke",
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/viewport/stroke",
          signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/viewport/stroke",
          signals: [
            { type: "position", context: { value: new Vector(3, 4) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool._entry.id).toBe(100);
    expect(tool._entry.position.serialize()).toEqual({ x: 1, y: 2 });
    expect(tool._entry.data.points).toEqual([
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
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [
          { type: "position", context: { value: new Vector(2, 3) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool._entry.data.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  test("单 end 信号应能被正确处理", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(101);

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(tool._entry.id).toBe(101);
    expect(tool._entry.position.serialize()).toEqual({ x: 5, y: 6 });
    expect(tool._entry.data.points).toEqual([{ x: 0, y: 0 }]);
  });

  test("构造参数应允许通过 property 指定新建笔画属性", () => {
    const tool = new StrokeCreatorTool({
      property: { color: "#ff0000", width: 4 },
    });
    const { deviceContext } = createBoardDeviceContext(102);

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
      },
      deviceContext,
    );

    expect(tool._entry.property).toMatchObject({ color: "#ff0000", width: 4 });
  });

  test("cancel 信号应重置正在创建的对象并撤销 transient 对象", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(1);
    const board = deviceContext.acc.board;
    const boardApi = deviceContext.acc.boardApi;
    const discardSpy = jest.spyOn(boardApi, "discardActiveObjects");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "cancel", context: {} }],
      },
      { acc: { board, boardApi, objectId: 1, ownerChunkId: 1 } },
    );

    expect(discardSpy).toHaveBeenCalledWith([1]);
    expect(tool._entry).toBeNull();
    expect(board.getObjectById).not.toHaveBeenCalled();
  });

  test("首次创建对象时应写回本地草稿并调用 createObject", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(9);
    const boardApi = deviceContext.acc.boardApi;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    expect(boardApi.createObject).toHaveBeenCalledWith(
      "StrokeObject",
      expect.objectContaining({
        id: 9,
        position: new Vector(1, 2),
      }),
    );
    expect(deviceContext._nodeState.objects).toEqual([tool._entry]);
  });

  test("显式提供 boardApi 时应通过 appendListItem 累计路径点并在 end 后提交", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(20);
    const boardApi = deviceContext.acc.boardApi;
    const createSpy = jest.spyOn(boardApi, "createObject");
    const appendSpy = jest.spyOn(boardApi, "appendListItem");
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
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
    expect(tool._entry.data.points).toEqual([
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
    expect(tool._entry.data.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test("创建手势更新后仅请求 UI overlay 刷新，不再直调 renderer", () => {
    const tool = new StrokeCreatorTool();
    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const { deviceContext } = createBoardDeviceContext(30, { viewport });

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    viewport.renderer.captureObjectSnapshot.mockClear();
    viewport.renderer.invalidateActiveObjects.mockClear();
    viewport.requestViewportUiRender.mockClear();

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    expect(viewport.renderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(viewport.renderer.invalidateActiveObjects).not.toHaveBeenCalled();
    expect(viewport.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("创建完成后应通过 commitObjects 提交笔画对象", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(21);
    const boardApi = deviceContext.acc.boardApi;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(boardApi.commitObjects).toHaveBeenCalledWith([21]);
  });

  test("取消创建后不应提交对象", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(22);
    const boardApi = deviceContext.acc.boardApi;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "cancel", context: {} }],
      },
      deviceContext,
    );

    expect(boardApi.commitObjects).not.toHaveBeenCalled();
    expect(boardApi.discardActiveObjects).toHaveBeenCalledWith([22]);
  });

  test("连续两次创建应生成两个不同笔画对象", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext(31);
    const board = deviceContext.acc.board;
    const boardApi = deviceContext.acc.boardApi;
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { acc: { board, boardApi, objectId: 31, ownerChunkId: 1 } },
    );

    const firstObject = tool._entry;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { acc: { board, boardApi, objectId: 31, ownerChunkId: 1 } },
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(4, 5) } }],
      },
      { acc: { board, boardApi, objectId: 32, ownerChunkId: 1 } },
    );

    const secondObject = tool._entry;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { acc: { board, boardApi, objectId: 32, ownerChunkId: 1 } },
    );

    expect(firstObject).not.toBe(secondObject);
    expect(firstObject.id).toBe(31);
    expect(secondObject.id).toBe(32);
    expect(commitSpy).toHaveBeenNthCalledWith(1, [31]);
    expect(commitSpy).toHaveBeenNthCalledWith(2, [32]);
  });

  describe("端到端集成（通过 Board 输入链路）", () => {
    test("挂载后的 StrokeCreatorTool 应可经由 Board 输入链路创建对象并提交到白板", async () => {
      const { board, viewport, cleanup } = await createWorkerBoardContext({
        boardWidth: 800,
        boardHeight: 600,
        viewportId: "main",
        viewportWidth: 800,
        viewportHeight: 600,
      });

      try {
        const tool = new StrokeCreatorTool();
        viewport.origin = new Vector(100, 50);
        viewport.zoom = 2;

        viewport.inputScope.mountDevice("", createMouseDevice());
        viewport.inputScope.mountWorkflow("primary-stroke", tool);
        viewport.inputScope.addEdge({
          from: "mouse/primary",
          to: "workflows/primary-stroke",
        });

        // canvas 相对坐标：world=(105,60) → ((105-100)*2, (60-50)*2) = (10, 20)
        board.signalsEventBus.emit("input", {
          to: "/main/mouse",
          signals: [
            {
              type: "position",
              context: {
                value: new Vector(10, 20),
                buttons: 1,
                button: 0,
              },
            },
          ],
        });

        // canvas 相对坐标：world=(110,65) → ((110-100)*2, (65-50)*2) = (20, 30)
        board.signalsEventBus.emit("input", {
          to: "/main/mouse",
          signals: [
            {
              type: "position",
              context: {
                value: new Vector(20, 30),
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
        await flushMicrotasks();

        await expect(
          board.getBoardApi().queryObjects([tool._entry.id]),
        ).resolves.toEqual([
          expect.objectContaining({
            id: tool._entry.id,
            isActive: false,
            position: { x: 105, y: 60 },
            data: expect.objectContaining({
              points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
              ],
            }),
          }),
        ]);
        expect(tool._entry.id).toBe(1);
        expect(tool._entry.position.serialize()).toEqual({ x: 105, y: 60 });
        expect(tool._entry.data.points).toEqual([
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ]);
      } finally {
        cleanup();
      }
    });

    test("挂载后的 StrokeCreatorTool 在绘制中应将对象保持在 Worker 的活动态", async () => {
      const { board, viewport, cleanup } = await createWorkerBoardContext({
        boardWidth: 800,
        boardHeight: 600,
        viewportId: "main",
        viewportWidth: 800,
        viewportHeight: 600,
      });

      try {
        const tool = new StrokeCreatorTool();
        viewport.origin = new Vector(100, 50);
        viewport.zoom = 2;

        viewport.inputScope.mountDevice("", createMouseDevice());

        viewport.inputScope.mountWorkflow("primary-stroke", tool);
        viewport.inputScope.addEdge({
          from: "mouse/primary",
          to: "workflows/primary-stroke",
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
        await flushMicrotasks();

        await expect(
          board.getBoardApi().queryObjects([tool._entry.id]),
        ).resolves.toEqual([
          expect.objectContaining({
            id: tool._entry.id,
            isActive: true,
          }),
        ]);
      } finally {
        cleanup();
      }
    });
  });
});
