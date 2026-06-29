import { jest } from "@jest/globals";
import { CircleCreatorTool } from "../circle-creator.js";
import { SingleGestureObjectCreatorTool } from "../object-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board } from "../../../components/index.js";
import { ChunkObjectManager } from "../../../components/chunk/chunk-object-manager.js";

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

describe("ObjectCreatorTool — property 信号", () => {
  test("Phase 1 带 property 信号 → 对象使用注入属性覆盖默认属性", () => {
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#000", fillColor: "#fff" },
    });
    const { deviceContext } = createBoardDeviceContext(201);

    tool.process(
      {
        to: "/monitor/circle",
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

    expect(tool.obj).toBeDefined();
    expect(tool.obj.property.strokeColor).toBe("hsl(120, 70%, 42%)");
    expect(tool.obj.property.width).toBe(3);
    expect(tool.obj.property.fillColor).toBe("#fff");
  });

  test("property 信号为 null / 非对象 → injectedProperty 为 null，对象使用默认属性", () => {
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#000" },
    });
    const { deviceContext } = createBoardDeviceContext(202);

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(0, 0) } },
          { type: "property", context: { value: null } },
        ],
      },
      deviceContext,
    );

    expect(tool.obj).toBeDefined();
    expect(tool.obj.property.strokeColor).toBe("#000");
  });

  test("无 property 信号 → 对象使用默认属性", () => {
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#abc" },
    });
    const { deviceContext } = createBoardDeviceContext(203);

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(3, 4) } }],
      },
      deviceContext,
    );

    expect(tool.obj).toBeDefined();
    expect(tool.obj.property.strokeColor).toBe("#abc");
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

  test("显式提供 boardApi 时仍应将真实对象实例写回上下文", () => {
    const tool = new CircleCreatorTool();
    const { board, deviceContext } = createBoardDeviceContext(206);

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(1, 1) } }],
      },
      deviceContext,
    );

    expect(deviceContext.acc.objects).toEqual([tool.obj]);
    expect(board.activeObjectManager.activeObjects.size).toBe(1);
    expect(board.getChunkById(1).objectManager.getObject(206)).toBeUndefined();
  });

  describe("生命周期钩子", () => {
    test("completeCreatedObject 后触发 afterCreate 通知", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() {}
        beginCreationGesture() {}
        updateCreationGesture() {}
        completeCreationGesture() {}
      }

      const tool = new TestCreator();
      const afterCreate = jest.fn();
      tool.on("afterCreate", afterCreate);

      tool.objectId = 1;
      tool.obj = { id: 1, type: "test" };
      tool.completeCreatedObject({ context: { acc: {} } });

      expect(afterCreate).toHaveBeenCalledTimes(1);
    });

    test("beforeCommitCreatedObject 返回 false 时阻止 commitObjects", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() {}
        beginCreationGesture() {}
        updateCreationGesture() {}
        completeCreationGesture() {}
      }

      const tool = new TestCreator();
      const boardApi = { commitObjects: jest.fn() };

      tool.beforeCommitCreatedObject = () => false;
      tool.objectId = 2;
      tool.obj = { id: 2 };
      tool.completeCreatedObject({ context: { acc: { boardApi } } });

      expect(boardApi.commitObjects).not.toHaveBeenCalled();
      expect(tool.isObjectCreationCompleted).toBe(true);
    });

    test("beforeCommitCreatedObject 默认返回 true → 对象通过 boardApi 提交", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() {}
        beginCreationGesture() {}
        updateCreationGesture() {}
        completeCreationGesture() {}
      }

      const tool = new TestCreator();
      const boardApi = { commitObjects: jest.fn() };

      tool.objectId = 3;
      tool.obj = { id: 3 };
      tool.completeCreatedObject({ context: { acc: { boardApi } } });

      expect(boardApi.commitObjects).toHaveBeenCalledWith([3]);
      expect(tool.isObjectCreationCompleted).toBe(true);
    });

    test("beforeCommit 返回 false 时 afterCreate 仍然触发", () => {
      class TestCreator extends SingleGestureObjectCreatorTool {
        create() {}
        beginCreationGesture() {}
        updateCreationGesture() {}
        completeCreationGesture() {}
      }

      const tool = new TestCreator();
      const afterCreate = jest.fn();
      tool.on("afterCreate", afterCreate);
      tool.beforeCommitCreatedObject = () => false;
      tool.objectId = 4;
      tool.obj = { id: 4 };

      tool.completeCreatedObject({ context: { acc: {} } });

      expect(afterCreate).toHaveBeenCalledTimes(1);
    });

    test("process 完整周期（position → end）触发 afterCreate", () => {
      const tool = new CircleCreatorTool();
      const afterCreate = jest.fn();
      const { deviceContext } = createBoardDeviceContext(301);
      tool.on("afterCreate", afterCreate);

      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(10, 10) } },
          ],
        },
        deviceContext,
      );

      expect(afterCreate).not.toHaveBeenCalled();

      tool.process({ signals: [{ type: "end" }] }, deviceContext);

      expect(afterCreate).toHaveBeenCalledTimes(1);
    });
  });
});
