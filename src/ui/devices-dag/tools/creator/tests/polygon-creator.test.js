import { jest } from "@jest/globals";
import { PolygonCreatorTool } from "../polygon-creator.js";
import { Vector } from "../../../../../kernel/utils/math.js";
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
      services: {
        board,
        boardApi,
        viewport,
      },
    },
  };
}

/**
 * 构造具备分子能力的 boardApi 测试上下文
 * @param {string} objectId - 分配的对象 id
 * @param {{ boardApiOverrides?: Object }} [options={}] - 选项（覆盖 boardApi 方法）
 * @returns {{ board: Object, boardApi: Object, deviceContext: Object }} 测试上下文
 */
function createMolBoardDeviceContext(objectId, { boardApiOverrides = {} } = {}) {
  const board = {
    allocateObjectId: jest.fn(() => objectId),
    getObjectById: jest.fn(() => undefined),
  };
  const boardApi = {
    createObject: jest.fn(async () => objectId),
    beginMol: jest.fn(() => "demo/mol-1"),
    amendMol: jest.fn(() => true),
    endMol: jest.fn(() => true),
    abortMol: jest.fn(() => true),
    appendListItem: jest.fn(),
    replaceListItem: jest.fn(),
    modifyObject: jest.fn(),
    commitObjects: jest.fn(async () => [objectId]),
    discardActiveObjects: jest.fn(),
    ...boardApiOverrides,
  };

  return {
    board,
    boardApi,
    deviceContext: {
      services: {
        board,
        boardApi,
        supraKey: "S",
      },
    },
  };
}

describe("PolygonCreatorTool", () => {
  test("PolygonCreatorTool 应在同一手势内更新当前顶点，并在 end 时固化", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext("10");

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
    const { deviceContext } = createBoardDeviceContext("99");

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
    const { deviceContext } = createBoardDeviceContext("10");

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
    const { deviceContext } = createBoardDeviceContext("10");
    const board = deviceContext.services.board;
    const boardApi = deviceContext.services.boardApi;
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
      { services: { board, boardApi } },
    );

    expect(discardSpy).toHaveBeenCalledWith(["10"]);
    expect(tool._entry).toBeNull();
    expect(tool.count).toBe(0);
    expect(tool.lastPoint).toBeNull();
    expect(board.getObjectById).not.toHaveBeenCalled();
  });

  test("object-end 信号应固化整个多边形对象", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext("10");

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
    const { deviceContext } = createBoardDeviceContext("10");
    const boardApi = deviceContext.services.boardApi;
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          {
            type: "position",
            context: { value: new Vector(5, 5) },
          },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          { type: "object-end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(commitSpy).toHaveBeenCalledWith(["10"]);
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
    const { deviceContext } = createBoardDeviceContext("31", { viewport });

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          {
            type: "position",
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
            type: "position",
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
    const { deviceContext } = createBoardDeviceContext("24");
    const boardApi = deviceContext.services.boardApi;
    const createSpy = jest.spyOn(boardApi, "createObject");
    const appendSpy = jest.spyOn(boardApi, "appendListItem");
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          {
            type: "position",
            context: { value: new Vector(5, 5) },
          },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          { type: "object-end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(createSpy).toHaveBeenCalledWith(
      "PolygonObject",
      expect.objectContaining({
        id: "24",
        position: new Vector(5, 5),
      }),
    );
    expect(appendSpy).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalledWith(["24"]);
    expect(tool._entry).toMatchObject({
      id: "24",
      position: new Vector(5, 5),
    });
  });

  test("RPC 风格 boardApi 下应维护本地草稿顶点并提交", () => {
    const tool = new PolygonCreatorTool();
    const board = {
      allocateObjectId: jest.fn(() => "703"),
    };
    const boardApi = {
      createObject: jest.fn(),
      appendListItem: jest.fn(),
      replaceListItem: jest.fn(),
      commitObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const deviceContext = {
      services: {
        board,
        boardApi,
      },
    };

    tool.process(
      {
        signals: [
          {
            type: "position",
            context: { value: new Vector(5, 5) },
          },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          { type: "object-end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.createObject).toHaveBeenCalledWith(
      "PolygonObject",
      expect.objectContaining({
        id: "703",
        position: new Vector(5, 5),
      }),
    );
    expect(boardApi.appendListItem).toHaveBeenCalled();
    expect(boardApi.commitObjects).toHaveBeenCalledWith(["703"]);
    expect(tool._entry.data.points).toEqual([{ x: 0, y: 0 }]);
  });

  test("object-end 后应通过 commitObjects 提交对象", () => {
    const tool = new PolygonCreatorTool();
    const { deviceContext } = createBoardDeviceContext("23");
    const boardApi = deviceContext.services.boardApi;

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          {
            type: "position",
            context: { value: new Vector(5, 5) },
          },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/polygon",
        signals: [
          { type: "object-end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.commitObjects).toHaveBeenCalledWith(["23"]);
  });

  describe("分子管线（多手势：object-end 才闭合分子）", () => {
    test("单个手势 end 不闭合分子，object-end 才 endMol → commitObjects", () => {
      const calls = [];
      const { boardApi, deviceContext } = createMolBoardDeviceContext("10", {
        boardApiOverrides: {
          createObject: jest.fn(() => {
            calls.push("createObject");
            return Promise.resolve("10");
          }),
          beginMol: jest.fn(() => {
            calls.push("beginMol");
            return "demo/mol-1";
          }),
          amendMol: jest.fn(() => {
            calls.push("amendMol");
            return true;
          }),
          replaceListItem: jest.fn(() => {
            calls.push("replaceListItem");
          }),
          endMol: jest.fn(() => {
            calls.push("endMol");
            return true;
          }),
          commitObjects: jest.fn(() => {
            calls.push("commitObjects");
            return Promise.resolve(["10"]);
          }),
        },
      });
      const tool = new PolygonCreatorTool();

      // 第一个手势：落笔 + 拖动 + 抬笔（end 仅结束当前手势）
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(8, 9) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(10, 12) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );

      expect(boardApi.beginMol).toHaveBeenCalledTimes(1);
      expect(boardApi.beginMol).toHaveBeenCalledWith(["10"], {
        create: true,
        supraKey: "S",
      });
      // 首顶点经 amend 流入 amend 流；顶点拖拽替换仍走 replaceListItem 直调
      expect(boardApi.amendMol).toHaveBeenCalledWith("demo/mol-1", {
        "10": { append: { key: "points", items: [{ x: 0, y: 0 }] } },
      });
      expect(boardApi.replaceListItem).toHaveBeenCalledWith("10", "points", 0, {
        x: 5,
        y: 7,
      });
      // 单手势 end 不闭合分子、不提交
      expect(boardApi.endMol).not.toHaveBeenCalled();
      expect(boardApi.commitObjects).not.toHaveBeenCalled();

      // 第二个手势：再落笔追加顶点（同一分子继续 amend）
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(20, 20) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );
      expect(boardApi.beginMol).toHaveBeenCalledTimes(1);
      expect(boardApi.amendMol).toHaveBeenLastCalledWith("demo/mol-1", {
        "10": { append: { key: "points", items: [{ x: 15, y: 15 }] } },
      });
      expect(boardApi.endMol).not.toHaveBeenCalled();

      // object-end：闭合分子并提交
      tool.process(
        { signals: [{ type: "object-end", context: {} }] },
        deviceContext,
      );
      expect(boardApi.endMol).toHaveBeenCalledWith("demo/mol-1");
      expect(boardApi.commitObjects).toHaveBeenCalledWith(["10"]);
      expect(calls).toEqual([
        "createObject",
        "beginMol",
        "amendMol",
        "replaceListItem",
        "replaceListItem",
        "amendMol",
        "endMol",
        "commitObjects",
      ]);
    });

    test("object-cancel：abortMol 中止分子并移除暂存对象", () => {
      const { boardApi, deviceContext } = createMolBoardDeviceContext("11");
      const tool = new PolygonCreatorTool();

      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(5, 5) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );
      tool.process(
        { signals: [{ type: "object-cancel", context: {} }] },
        deviceContext,
      );

      expect(boardApi.abortMol).toHaveBeenCalledWith("demo/mol-1");
      expect(boardApi.endMol).not.toHaveBeenCalled();
      expect(boardApi.discardActiveObjects).not.toHaveBeenCalled();
      expect(boardApi.commitObjects).not.toHaveBeenCalled();
      expect(tool._entry).toBeNull();
      expect(tool.count).toBe(0);
    });

    test("Worker 挂起跨手势缓冲保序：确认后按序补发，object-end 延迟闭合", async () => {
      const calls = [];
      let resolveBegin;
      const beginPromise = new Promise((resolve) => {
        resolveBegin = resolve;
      });
      const { boardApi, deviceContext } = createMolBoardDeviceContext("12", {
        boardApiOverrides: {
          beginMol: jest.fn(() => {
            calls.push("beginMol");
            return beginPromise;
          }),
          amendMol: jest.fn(() => {
            calls.push("amendMol");
            return true;
          }),
          replaceListItem: jest.fn(() => {
            calls.push("replaceListItem");
          }),
          endMol: jest.fn(() => {
            calls.push("endMol");
            return true;
          }),
          commitObjects: jest.fn(() => {
            calls.push("commitObjects");
            return Promise.resolve(["12"]);
          }),
        },
      });
      const tool = new PolygonCreatorTool();

      // 第一个手势全程处于 molId 确认中：append/replace 均按序缓冲
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(8, 9) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(10, 12) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );
      expect(boardApi.amendMol).not.toHaveBeenCalled();
      expect(boardApi.replaceListItem).not.toHaveBeenCalled();
      expect(boardApi.appendListItem).not.toHaveBeenCalled();

      // object-end（molId 仍未确认）：延迟闭合与提交
      tool.process(
        { signals: [{ type: "object-end", context: {} }] },
        deviceContext,
      );
      expect(boardApi.endMol).not.toHaveBeenCalled();
      expect(boardApi.commitObjects).not.toHaveBeenCalled();

      // molId 到达：append → replace×2 保序补发，随后 endMol → commitObjects
      resolveBegin("demo/mol-1");
      await flushMicrotasks();
      expect(boardApi.amendMol).toHaveBeenCalledTimes(1);
      expect(boardApi.amendMol).toHaveBeenCalledWith("demo/mol-1", {
        "12": { append: { key: "points", items: [{ x: 0, y: 0 }] } },
      });
      expect(boardApi.replaceListItem).toHaveBeenNthCalledWith(
        1,
        "12",
        "points",
        0,
        { x: 3, y: 4 },
      );
      expect(boardApi.replaceListItem).toHaveBeenNthCalledWith(
        2,
        "12",
        "points",
        0,
        { x: 5, y: 7 },
      );
      expect(boardApi.endMol).toHaveBeenCalledWith("demo/mol-1");
      expect(boardApi.commitObjects).toHaveBeenCalledWith(["12"]);
      expect(calls).toEqual([
        "beginMol",
        "amendMol",
        "replaceListItem",
        "replaceListItem",
        "endMol",
        "commitObjects",
      ]);
    });
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

        viewport.inputScope.mountDevice("", createMouseDevice());
        viewport.inputScope.mountWorkflow("primary-polygon", tool);
        viewport.inputScope.addEdge({
          from: "mouse/primary",
          to: "workflows/primary-polygon",
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
          board.getBoardApi().queryObjectDetails([tool._entry.id]),
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
        expect(tool._entry.id).toBe("1");
        expect(tool._entry.position.serialize()).toEqual({ x: 125, y: 80 });
        expect(tool._entry.data.points).toEqual([{ x: 0, y: 0 }]);
      } finally {
        cleanup();
      }
    });
  });
});
