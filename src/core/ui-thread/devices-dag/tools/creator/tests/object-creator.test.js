import { jest } from "@jest/globals";
import { CircleDataCreatorTool } from "../circle/data-creator.js";
import { createCircleRadiusProcessor } from "../circle/radius-processor.js";
import { SingleGestureObjectCreatorTool } from "../object-creator.js";
import { Vector } from "../../../../../engine/utils/math.js";
function createBoardDeviceContext(objectId, { viewport } = {}) {
  const board = {
    allocateObjectId: jest.fn(() => objectId),
    getObjectById: jest.fn(() => undefined),
  };
  const boardApi = {
    createObject: jest.fn(async () => objectId),
    modifyObject: jest.fn(),
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
    services: {
      board,
      boardApi,
      viewport,
    },
  };

  return { board, boardApi, deviceContext };
}

describe("ObjectCreatorTool — property 信号", () => {
  test("Phase 1 带 property 信号 → 对象使用注入属性覆盖默认属性", () => {
    const tool = new CircleDataCreatorTool({
      property: { strokeColor: "#000", fillColor: "#fff" },
      processor: createCircleRadiusProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(201);

    tool.process(
      {
        to: "/viewport/circle",
        signals: [
          {
            type: "position",
            context: { value: new Vector(5, 5) },
          },
          {
            type: "property",
            context: {
              value: { strokeColor: "hsl(120, 70%, 42%)", width: 3 },
            },
          },
        ],
      },
      deviceContext,
    );

    expect(tool._entry).toBeDefined();
    expect(tool._entry.property.strokeColor).toBe("hsl(120, 70%, 42%)");
    expect(tool._entry.property.width).toBe(3);
    expect(tool._entry.property.fillColor).toBe("#fff");
  });

  test("property 信号为 null / 非对象 → injectedProperty 为 null，对象使用默认属性", () => {
    const tool = new CircleDataCreatorTool({
      property: { strokeColor: "#000" },
      processor: createCircleRadiusProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(202);

    tool.process(
      {
        to: "/viewport/circle",
        signals: [
          { type: "position", context: { value: new Vector(0, 0) } },
          { type: "property", context: { value: null } },
        ],
      },
      deviceContext,
    );

    expect(tool._entry).toBeDefined();
    expect(tool._entry.property.strokeColor).toBe("#000");
  });

  test("无 property 信号 → 对象使用默认属性", () => {
    const tool = new CircleDataCreatorTool({
      property: { strokeColor: "#abc" },
      processor: createCircleRadiusProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(203);

    tool.process(
      {
        to: "/viewport/circle",
        signals: [{ type: "position", context: { value: new Vector(3, 4) } }],
      },
      deviceContext,
    );

    expect(tool._entry).toBeDefined();
    expect(tool._entry.property.strokeColor).toBe("#abc");
  });

  test("buildInteractionContext 在基类中提取 injectedProperty", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleRadiusProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(204);

    const interaction = tool.buildInteractionContext(
      {
        to: "/",
        signals: [
          { type: "position", context: { value: { x: 1, y: 2 } } },
          { type: "property", context: { value: { width: 5 } } },
        ],
      },
      deviceContext,
    );

    expect(interaction.injectedProperty).toEqual({ width: 5 });
    expect(interaction.position).toEqual(new Vector(1, 2));
  });

  test("property 为数组值 → injectedProperty 为 null", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleRadiusProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(205);

    const interaction = tool.buildInteractionContext(
      {
        to: "/",
        signals: [
          { type: "position", context: { value: { x: 0, y: 0 } } },
          { type: "property", context: { value: ["invalid", "array"] } },
        ],
      },
      deviceContext,
    );

    expect(interaction.injectedProperty).toBeNull();
  });

  test("显式提供 boardApi 时仍应将本地草稿对象写回上下文", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleRadiusProcessor(),
    });
    const { boardApi, deviceContext } = createBoardDeviceContext(206);

    tool.process(
      {
        to: "/viewport/circle",
        signals: [{ type: "position", context: { value: new Vector(1, 1) } }],
      },
      deviceContext,
    );

    expect(deviceContext._nodeState.objects).toEqual([tool._entry]);
    expect(deviceContext.services.boardApi.createObject).toHaveBeenCalledWith(
      "CircleObject",
      expect.objectContaining({
        id: 206,
        position: new Vector(1, 1),
      }),
    );
  });

  test("RPC 风格 boardApi 下应直接创建本地草稿对象，不再回填 board 实例", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleRadiusProcessor(),
    });
    const board = {
      allocateObjectId: jest.fn(() => 901),
      getObjectById: jest.fn(() => undefined),
    };
    const boardApi = {
      createObject: jest.fn(),
      modifyObject: jest.fn(),
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
      services: {
        board,
        boardApi,
      },
    };

    tool.process(
      {
        to: "/viewport/circle",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    expect(board.allocateObjectId).toHaveBeenCalledTimes(1);
    expect(board.getObjectById).not.toHaveBeenCalled();
    expect(boardApi.createObject).toHaveBeenCalledWith(
      "CircleObject",
      expect.objectContaining({
        id: 901,
        position: new Vector(2, 3),
      }),
    );
    expect(tool._entry.position.serialize()).toEqual({ x: 2, y: 3 });
    expect(tool._entry.data.radius).toBe(0);
    expect(deviceContext._nodeState.objects).toEqual([tool._entry]);
  });

  describe("生命周期钩子", () => {
    test("completeCreatedObject 后触发 action:complete 通知", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() { }
        getCreatedObjectType() {
          return "test";
        }
        resolveCreatedObjectBoundingBox() {
          return { left: 0, top: 0, width: 0, height: 0 };
        }
        beginGesture() { }
        updateGesture() { }
        completeGesture() { }
      }

      const tool = new TestCreator();
      const actionComplete = jest.fn();
      tool.on("action:complete", actionComplete);

      tool.objectId = 1;
      tool._entry = { id: 1, type: "test" };
      const context = {};
      tool.completeCreatedObject({ context });

      expect(actionComplete).toHaveBeenCalledTimes(1);
      expect(actionComplete).toHaveBeenCalledWith(context, {
        id: 1,
        type: "test",
        boundingBox: { left: 0, top: 0, width: 0, height: 0 },
      });
    });

    test("beforeCommitCreatedObject 返回 false 时阻止 commitObjects", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() { }
        getCreatedObjectType() {
          return "test";
        }
        resolveCreatedObjectBoundingBox() {
          return { left: 0, top: 0, width: 0, height: 0 };
        }
        beginGesture() { }
        updateGesture() { }
        completeGesture() { }
      }

      const tool = new TestCreator();
      const boardApi = { commitObjects: jest.fn() };

      tool.beforeCommitCreatedObject = () => false;
      tool.objectId = 2;
      tool._entry = { id: 2, type: "test" };
      tool.completeCreatedObject({ context: { services: { boardApi } } });

      expect(boardApi.commitObjects).not.toHaveBeenCalled();
      expect(tool.isObjectCreationCompleted).toBe(true);
    });

    test("beforeCommitCreatedObject 默认返回 true → 对象通过 boardApi 提交", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() { }
        getCreatedObjectType() {
          return "test";
        }
        resolveCreatedObjectBoundingBox() {
          return { left: 0, top: 0, width: 0, height: 0 };
        }
        beginGesture() { }
        updateGesture() { }
        completeGesture() { }
      }

      const tool = new TestCreator();
      const boardApi = { commitObjects: jest.fn() };

      tool.objectId = 3;
      tool._entry = { id: 3, type: "test" };
      tool.completeCreatedObject({ context: { services: { boardApi } } });

      expect(boardApi.commitObjects).toHaveBeenCalledWith([3]);
      expect(tool.isObjectCreationCompleted).toBe(true);
    });

    test("beforeCommit 返回 false 时 action:complete 仍然触发", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() { }
        getCreatedObjectType() {
          return "test";
        }
        resolveCreatedObjectBoundingBox() {
          return { left: 0, top: 0, width: 0, height: 0 };
        }
        beginGesture() { }
        updateGesture() { }
        completeGesture() { }
      }

      const tool = new TestCreator();
      const actionComplete = jest.fn();
      tool.on("action:complete", actionComplete);
      tool.beforeCommitCreatedObject = () => false;
      tool.objectId = 4;
      tool._entry = { id: 4, type: "test" };

      tool.completeCreatedObject({ context: {} });

      expect(actionComplete).toHaveBeenCalledTimes(1);
    });

    test("process 完整周期（position → end）触发 action:complete", () => {
      const tool = new CircleDataCreatorTool({
        processor: createCircleRadiusProcessor(),
      });
      const actionComplete = jest.fn();
      const { deviceContext } = createBoardDeviceContext(301);
      tool.on("action:complete", actionComplete);

      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(10, 10) } },
          ],
        },
        deviceContext,
      );

      expect(actionComplete).not.toHaveBeenCalled();

      tool.process({ signals: [{ type: "end" }] }, deviceContext);

      expect(actionComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("entry 协议校验", () => {
    test("entry.type 与 getCreatedObjectType() 不匹配时 finalize 应抛错", () => {
      class BadTypeCreator extends SingleGestureObjectCreatorTool {
        create() { }
        getCreatedObjectType() {
          return "ExpectedObject";
        }
        resolveCreatedObjectBoundingBox() {
          return { left: 0, top: 0, width: 0, height: 0 };
        }
        beginGesture() { }
        updateGesture() { }
        completeGesture() { }
      }

      const tool = new BadTypeCreator();
      tool.objectId = 11;
      tool._entry = { id: 11, type: "WrongObject" };

      expect(() => tool.completeCreatedObject({ context: {} })).toThrow(
        /entry\.type.*must match getCreatedObjectType/,
      );
    });

    test("resolveCreatedObjectBoundingBox 未覆写时 finalize 应抛错", () => {
      class NoBoundingBoxCreator extends SingleGestureObjectCreatorTool {
        create() { }
        getCreatedObjectType() {
          return "test";
        }
        beginGesture() { }
        updateGesture() { }
        completeGesture() { }
      }

      const tool = new NoBoundingBoxCreator();
      tool.objectId = 12;
      tool._entry = { id: 12, type: "test" };

      expect(() => tool.completeCreatedObject({ context: {} })).toThrow(
        "Method not implemented.",
      );
    });

    test("resolveCreatedObjectBoundingBox 返回空时 finalize 应抛错并提示 handoff 依赖", () => {
      class EmptyBoundingBoxCreator extends SingleGestureObjectCreatorTool {
        create() { }
        getCreatedObjectType() {
          return "test";
        }
        resolveCreatedObjectBoundingBox() {
          return undefined;
        }
        beginGesture() { }
        updateGesture() { }
        completeGesture() { }
      }

      const tool = new EmptyBoundingBoxCreator();
      tool.objectId = 13;
      tool._entry = { id: 13, type: "test" };

      expect(() => tool.completeCreatedObject({ context: {} })).toThrow(
        /resolveCreatedObjectBoundingBox\(\) must return a bounding box/,
      );
    });
  });

  describe("创建失败兜底与提交对账", () => {
    function createFailingBoardDeviceContext(objectId, error) {
      const board = {
        allocateObjectId: jest.fn(() => objectId),
        getObjectById: jest.fn(() => undefined),
      };
      const boardApi = {
        createObject: jest.fn(() => Promise.reject(error)),
        modifyObject: jest.fn(),
        commitObjects: jest.fn(async () => []),
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
        services: {
          board,
          boardApi,
        },
      };

      return { board, boardApi, deviceContext };
    }

    test("createObject 失败应清理本地草稿并闩锁，阻断后续无效 RPC", async () => {
      global.allowConsoleError();
      console.error.mockClear();
      const tool = new CircleDataCreatorTool({
        processor: createCircleRadiusProcessor(),
      });
      const { boardApi, deviceContext } = createFailingBoardDeviceContext(
        501,
        new Error("Unsupported object type"),
      );

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(1, 1) } }],
        },
        deviceContext,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      // 本地状态清理 + 失败告警
      expect(console.error).toHaveBeenCalled();
      expect(tool._entry).toBeNull();
      expect(tool.objectId).toBeNull();
      expect(tool.isActionActive).toBe(false);

      // 闩锁：同一手势内后续 position 不再重试创建，也不再有新的 modifyObject
      const modifyCallsAfterFailure = boardApi.modifyObject.mock.calls.length;

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
        },
        deviceContext,
      );

      expect(boardApi.createObject).toHaveBeenCalledTimes(1);
      expect(boardApi.modifyObject).toHaveBeenCalledTimes(
        modifyCallsAfterFailure,
      );
      expect(boardApi.discardActiveObjects).not.toHaveBeenCalled();
    });

    test("失败闩锁在 end 后解除，下一次落笔重新尝试创建", async () => {
      global.allowConsoleError();
      console.error.mockClear();
      const tool = new CircleDataCreatorTool({
        processor: createCircleRadiusProcessor(),
      });
      const { boardApi, deviceContext } = createFailingBoardDeviceContext(
        502,
        new Error("Unsupported object type"),
      );

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(1, 1) } }],
        },
        deviceContext,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(boardApi.createObject).toHaveBeenCalledTimes(1);

      tool.process({ signals: [{ type: "end" }] }, deviceContext);

      // Worker 侧恢复可用，下一次落笔应重新尝试
      boardApi.createObject.mockImplementation(async () => 502);
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(3, 3) } }],
        },
        deviceContext,
      );

      expect(boardApi.createObject).toHaveBeenCalledTimes(2);
      expect(tool._entry).not.toBeNull();
    });

    test("commitObjects 回执缺失期望 id 时应告警，包含时不告警", async () => {
      global.allowConsoleError();
      console.error.mockClear();
      const tool = new CircleDataCreatorTool({
        processor: createCircleRadiusProcessor(),
      });
      const { boardApi, deviceContext } = createBoardDeviceContext(503);
      boardApi.commitObjects = jest.fn(async () => []);

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(0, 0) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(8, 0) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("was lost"),
      );

      // 正常回执：包含期望 id，不告警
      console.error.mockClear();
      const tool2 = new CircleDataCreatorTool({
        processor: createCircleRadiusProcessor(),
      });
      const { boardApi: boardApi2, deviceContext: deviceContext2 } =
        createBoardDeviceContext(504);
      boardApi2.commitObjects = jest.fn(async () => [504]);

      tool2.process(
        {
          signals: [{ type: "position", context: { value: new Vector(0, 0) } }],
        },
        deviceContext2,
      );
      tool2.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(8, 0) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext2,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(console.error).not.toHaveBeenCalled();
    });
  });
});
