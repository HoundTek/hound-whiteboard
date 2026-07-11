import { jest } from "@jest/globals";
import { PolygonCreatorTool } from "../polygon-creator.js";
import { Vector } from "../../../../../utils/math.js";
import { OBJECT_CREATOR_SIGNAL_TYPES } from "../object-creator.js";
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
    replaceListItem: jest.fn(),
    commitObjects: jest.fn(),
    discardActiveObjects: jest.fn(),
  };

  return {
    deviceContext: {
      acc: {
        board,
        boardApi,
        viewport,
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
        to: "/viewport/polygon",
        signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [{ type: "position", context: { value: new Vector(8, 9) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          { type: "position", context: { value: new Vector(10, 12) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool._entry.data.points).toEqual([{ x: 5, y: 7 }]);
    expect(tool._entry.position.serialize()).toEqual({ x: 5, y: 5 });
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
        to: "/viewport/polygon",
        signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
      },
      deviceContext,
    );

    expect(tool._entry.property).toMatchObject({
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
        to: "/viewport/polygon",
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
        to: "/viewport/polygon",
        signals: [{ type: "cancel", context: {} }],
      },
      deviceContext,
    );

    expect(tool._entry.data.points).toEqual([{ x: 0, y: 0 }]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-cancel 信号应取消整个多边形对象并撤销 transient 对象", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext(10);
    const board = deviceContext.acc.board;
    const boardApi = deviceContext.acc.boardApi;
    const discardSpy = jest.spyOn(boardApi, "discardActiveObjects");

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          { type: "position", context: { value: new Vector(5, 5) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [{ type: "object-cancel", context: {} }],
      },
      { acc: { board, boardApi, objectId: 10, ownerChunkId: 1 } },
    );

    expect(discardSpy).toHaveBeenCalledWith([10]);
    expect(tool._entry).toBeNull();
    expect(tool.count).toBe(0);
    expect(tool.lastPoint).toBeNull();
    expect(board.getObjectById).not.toHaveBeenCalled();
  });

  test("object-end 信号应固化整个多边形对象", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext(10);

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          { type: "position", context: { value: new Vector(5, 5) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [{ type: "object-end", context: {} }],
      },
      deviceContext,
    );

    expect(tool._entry.data.points).toEqual([{ x: 0, y: 0 }]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-end 后应通过 boardApi.commitObjects 提交对象", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext(10);
    const boardApi = deviceContext.acc.boardApi;
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/viewport/polygon",
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
        to: "/viewport/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      deviceContext,
    );

    expect(commitSpy).toHaveBeenCalledWith([10]);
  });

  test("顶点更新后仅请求 UI overlay 刷新，不再直调 renderer", () => {
    const tool = new PolygonCreatorTool();
    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const { deviceContext } = createBoardDeviceContext(31, { viewport });

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          {
            type: OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
            context: { value: new Vector(5, 5) },
          },
        ],
      },
      deviceContext,
    );

    viewport.renderer.captureObjectSnapshot.mockClear();
    viewport.renderer.invalidateActiveObjects.mockClear();
    viewport.requestViewportUiRender.mockClear();

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          {
            type: OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
            context: { value: new Vector(8, 9) },
          },
        ],
      },
      deviceContext,
    );

    expect(viewport.renderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(viewport.renderer.invalidateActiveObjects).not.toHaveBeenCalled();
    expect(viewport.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("显式提供 boardApi 时应通过 RPC 创建并提交多边形对象", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext(24);
    const boardApi = deviceContext.acc.boardApi;
    const createSpy = jest.spyOn(boardApi, "createObject");
    const appendSpy = jest.spyOn(boardApi, "appendListItem");
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/viewport/polygon",
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
        to: "/viewport/polygon",
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
    expect(tool._entry).toMatchObject({
      id: 24,
      position: new Vector(5, 5),
    });
  });

  test("RPC 风格 boardApi 下应维护本地草稿顶点并提交", () => {
    const tool = new PolygonCreatorTool();
    const board = {
      allocateObjectId: jest.fn(() => 703),
    };
    const boardApi = {
      createObject: jest.fn(),
      appendListItem: jest.fn(),
      replaceListItem: jest.fn(),
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
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.createObject).toHaveBeenCalledWith(
      "PolygonObject",
      expect.objectContaining({
        id: 703,
        position: new Vector(5, 5),
      }),
    );
    expect(boardApi.appendListItem).toHaveBeenCalled();
    expect(boardApi.commitObjects).toHaveBeenCalledWith([703]);
    expect(tool._entry.data.points).toEqual([{ x: 0, y: 0 }]);
  });

  test("object-end 后应通过 commitObjects 提交对象", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext(23);
    const boardApi = deviceContext.acc.boardApi;

    tool.process(
      {
        to: "/viewport/polygon",
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
        to: "/viewport/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.commitObjects).toHaveBeenCalledWith([23]);
  });

  describe("端到端集成（通过 Board 输入链路）", () => {
    test("挂载后的 PolygonCreatorTool 应可经由输入链路完成 object-end 提交", async () => {
      const { board, viewport, cleanup } = await createWorkerBoardContext({
        boardWidth: 800,
        boardHeight: 600,
        viewportId: "main",
        viewportWidth: 800,
        viewportHeight: 600,
      });

      try {
        const tool = new PolygonCreatorTool();
        viewport.origin = new Vector(100, 50);
        viewport.zoom = 2;

        viewport.mountSubDAG("", createMouseDevice());
        board.signalsEventBus.emit("mount", {
          viewportId: "main",
          name: "primary-polygon",
          workflow: tool,
          edges: [{ from: "/mouse/primary", edge: "default" }],
        });

        // canvas 相对坐标：world=(125,80) → ((125-100)*2, (80-50)*2) = (50, 60)
        board.signalsEventBus.emit("input", {
          to: "/main/mouse/primary",
          signals: [
            {
              type: "position",
              context: {
                value: new Vector(50, 60),
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
        await flushMicrotasks();

        await expect(
          board.getBoardApi().queryObjects([tool._entry.id]),
        ).resolves.toEqual([
          expect.objectContaining({
            id: tool._entry.id,
            isActive: false,
            position: { x: 125, y: 80 },
            data: expect.objectContaining({
              points: [{ x: 0, y: 0 }],
            }),
          }),
        ]);
        expect(tool._entry.id).toBe(1);
        expect(tool._entry.position.serialize()).toEqual({ x: 125, y: 80 });
        expect(tool._entry.data.points).toEqual([{ x: 0, y: 0 }]);
      } finally {
        cleanup();
      }
    });
  });
});
