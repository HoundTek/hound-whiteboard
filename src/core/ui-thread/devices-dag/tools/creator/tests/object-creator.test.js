import { jest } from "@jest/globals";
import { CircleCreatorTool } from "../circle-creator.js";
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
    acc: {
      objectId,
    },
  };

  return { board, boardApi, deviceContext };
}

describe("ObjectCreatorTool — property 信号", () => {
  test("Phase 1 带 property 信号 → 对象使用注入属性覆盖默认属性", () => {
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#000", fillColor: "#fff" },
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
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#000" },
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
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#abc" },
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
    const tool = new CircleCreatorTool();
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
    const tool = new CircleCreatorTool();
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
    const tool = new CircleCreatorTool();
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
    const tool = new CircleCreatorTool();
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
        create() {}
        beginGesture() {}
        updateGesture() {}
        completeGesture() {}
      }

      const tool = new TestCreator();
      const actionComplete = jest.fn();
      tool.on("action:complete", actionComplete);

      tool.objectId = 1;
      tool._entry = { id: 1, type: "test" };
      tool.completeCreatedObject({ context: { acc: {} } });

      expect(actionComplete).toHaveBeenCalledTimes(1);
      expect(actionComplete).toHaveBeenCalledWith(
        expect.objectContaining({ acc: {} }),
        { id: 1, type: "test" },
      );
    });

    test("beforeCommitCreatedObject 返回 false 时阻止 commitObjects", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() {}
        beginGesture() {}
        updateGesture() {}
        completeGesture() {}
      }

      const tool = new TestCreator();
      const boardApi = { commitObjects: jest.fn() };

      tool.beforeCommitCreatedObject = () => false;
      tool.objectId = 2;
      tool._entry = { id: 2 };
      tool.completeCreatedObject({ context: { services: { boardApi } } });

      expect(boardApi.commitObjects).not.toHaveBeenCalled();
      expect(tool.isObjectCreationCompleted).toBe(true);
    });

    test("beforeCommitCreatedObject 默认返回 true → 对象通过 boardApi 提交", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() {}
        beginGesture() {}
        updateGesture() {}
        completeGesture() {}
      }

      const tool = new TestCreator();
      const boardApi = { commitObjects: jest.fn() };

      tool.objectId = 3;
      tool._entry = { id: 3 };
      tool.completeCreatedObject({ context: { services: { boardApi } } });

      expect(boardApi.commitObjects).toHaveBeenCalledWith([3]);
      expect(tool.isObjectCreationCompleted).toBe(true);
    });

    test("beforeCommit 返回 false 时 action:complete 仍然触发", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() {}
        beginGesture() {}
        updateGesture() {}
        completeGesture() {}
      }

      const tool = new TestCreator();
      const actionComplete = jest.fn();
      tool.on("action:complete", actionComplete);
      tool.beforeCommitCreatedObject = () => false;
      tool.objectId = 4;
      tool._entry = { id: 4 };

      tool.completeCreatedObject({ context: { acc: {} } });

      expect(actionComplete).toHaveBeenCalledTimes(1);
    });

    test("process 完整周期（position → end）触发 action:complete", () => {
      const tool = new CircleCreatorTool();
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
});
