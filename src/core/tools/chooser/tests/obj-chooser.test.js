import { jest } from "@jest/globals";
import { ObjectChooserTool } from "../obj-chooser.js";
import { RectangleObjectChooserTool } from "../rectangle-object-chooser.js";
import { RectangleRange } from "../../../range/index.js";
import { Vector } from "../../../utils/math.js";
import { createStateAccess } from "../../../test-support/state-fixtures.js";

describe("ObjectChooserTool", () => {
  class TestChooserTool extends ObjectChooserTool {
    constructor(options = {}) {
      super(options);
      this.chosenObjects = options.chosenObjects ?? [];
    }

    choose() {
      return this.chosenObjects;
    }

    reset() {}
  }

  test("process 应将选择结果加入 AOM 并写回上下文", () => {
    const chosenObject = { id: 1 };
    const board = {
      activeObjectManager: {
        choose: jest.fn(),
      },
    };
    const stateAccess = createStateAccess();
    const deviceContext = {
      context: { board },
      path: "/monitor/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };
    const tool = new TestChooserTool({ chosenObjects: [chosenObject] });

    tool.process(
      { signals: [{ type: "trigger", context: {} }] },
      deviceContext,
    );

    expect(board.activeObjectManager.choose).toHaveBeenCalledWith(
      new Set([chosenObject]),
    );
    expect(deviceContext.context.objects).toEqual([chosenObject]);
    expect(stateAccess.getState()).toEqual({
      objects: [chosenObject],
    });
  });

  test("umount 应撤销当前选择并清理上下文", () => {
    const chosenObject = { id: 4 };
    const board = {
      activeObjectManager: {
        discard: jest.fn(),
      },
    };
    const tool = new TestChooserTool();
    const stateAccess = createStateAccess({
      objects: [chosenObject],
    });
    const deviceContext = {
      context: { board, objects: [chosenObject] },
      path: "/monitor/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.umount(deviceContext);

    expect(board.activeObjectManager.discard).toHaveBeenCalledWith(
      new Set([chosenObject]),
    );
    expect(deviceContext.context.objects).toBeUndefined();
    expect(stateAccess.getState()).toEqual({});
  });

  test("collectUiOverlayEntries 在子 modifier 已有对象时不应重复声明 chooser 选择框", () => {
    const chosenObject = { id: 5 };
    const tool = new TestChooserTool();
    const renderer = {
      createCompatSelectionEntriesForObjects: jest.fn(() => [
        "chooser-overlay",
      ]),
    };

    const suppressed = tool.collectUiOverlayEntries({
      deviceContext: {
        context: { objects: [chosenObject] },
        path: "/monitor/chooser/tool",
        dag: {
          resolveDefaultLeaf: () => ({
            path: "/monitor/chooser/tool/tool",
            state: { objects: [chosenObject] },
          }),
        },
      },
      renderer,
    });

    expect(suppressed).toEqual([]);
    expect(
      renderer.createCompatSelectionEntriesForObjects,
    ).not.toHaveBeenCalled();

    const visible = tool.collectUiOverlayEntries({
      deviceContext: {
        context: { objects: [chosenObject] },
        path: "/monitor/chooser/tool",
        dag: {
          resolveDefaultLeaf: () => ({
            path: "/monitor/chooser/tool",
            state: {},
          }),
        },
      },
      renderer,
    });

    expect(visible).toEqual(["chooser-overlay"]);
    expect(
      renderer.createCompatSelectionEntriesForObjects,
    ).toHaveBeenCalledWith([chosenObject], "chooser");
  });

  test("resolveObjectSelectionWorldRange 应使用对象主判定范围而不是 boundingBox", () => {
    const tool = new TestChooserTool();
    const objectEntry = {
      id: 6,
      position: new Vector(100, 200),
      boundingBox: new RectangleRange(0, 0, 40, 50),
      getRange() {
        return new RectangleRange(10, 20, 5, 6);
      },
    };

    expect(tool.resolveObjectSelectionWorldRange({}, objectEntry)).toEqual(
      new RectangleRange(110, 220, 5, 6),
    );
  });

  describe("生命周期钩子", () => {
    test("afterChoose 在有选中对象时触发", () => {
      const chosenObject = { id: 10 };
      const board = {
        activeObjectManager: { choose: jest.fn() },
      };
      const stateAccess = createStateAccess();
      const deviceContext = {
        context: { board },
        path: "/test",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
      };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      const afterChoose = jest.fn();
      tool.on("afterChoose", afterChoose);

      tool.process({ signals: [{ type: "trigger" }] }, deviceContext);

      expect(afterChoose).toHaveBeenCalledTimes(1);
      expect(afterChoose).toHaveBeenCalledWith([chosenObject]);
    });

    test("afterChoose 在无选中对象时不触发", () => {
      const board = {
        activeObjectManager: { choose: jest.fn() },
      };
      const tool = new TestChooserTool({ chosenObjects: [] });
      const afterChoose = jest.fn();
      tool.on("afterChoose", afterChoose);

      tool.process(
        { signals: [{ type: "trigger" }] },
        {
          context: { board },
          path: "/test",
          getNodeState: () => ({}),
          setNodeState: () => {},
        },
      );

      expect(afterChoose).not.toHaveBeenCalled();
    });

    test("confirmSelection → beforeConfirm 返回 false 时阻止 afterConfirm", () => {
      const chosenObject = { id: 11 };
      const board = {
        activeObjectManager: { choose: jest.fn() },
      };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      const afterConfirm = jest.fn();
      tool.on("afterConfirm", afterConfirm);
      tool.beforeConfirmSelection = () => false;

      const result = tool.confirmSelection({ context: { board }, path: "/test" }, [
        chosenObject,
      ]);

      expect(result).toBe(false);
      expect(afterConfirm).not.toHaveBeenCalled();
    });

    test("confirmSelection 默认触发 afterConfirm", () => {
      const chosenObject = { id: 12 };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      const afterConfirm = jest.fn();
      tool.on("afterConfirm", afterConfirm);

      const result = tool.confirmSelection({ context: { board: {} }, path: "/test" }, [
        chosenObject,
      ]);

      expect(result).toBe(true);
      expect(afterConfirm).toHaveBeenCalledTimes(1);
      expect(afterConfirm).toHaveBeenCalledWith({ context: { board: {} }, path: "/test" }, [
        chosenObject,
      ]);
    });

    test("RectangleObjectChooserTool 在 end 信号时调用 confirmSelection", () => {
      // 准备一个虚拟对象用于框选命中
      const objectInBoard = {
        id: 20,
        position: new Vector(50, 50),
        getRange() {
          return new RectangleRange(0, 0, 10, 10);
        },
      };
      const board = {
        objectLoaded: new Map([["chunk-1", { obj: objectInBoard }]]),
        activeObjectManager: {
          activeObjectIndex: new Map(),
          choose: jest.fn(),
          discard: jest.fn(),
        },
      };
      const stateAccess = createStateAccess();
      const deviceContext = {
        context: { board },
        path: "/monitor/chooser",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
      };

      const tool = new RectangleObjectChooserTool();
      const afterConfirm = jest.fn();
      const afterChoose = jest.fn();
      tool.on("afterConfirm", afterConfirm);
      tool.on("afterChoose", afterChoose);

      // 先发送 position 信号，建立拖拽状态
      tool.process(
        {
          signals: [
            {
              type: "position",
              context: { value: new Vector(0, 0) },
            },
          ],
        },
        deviceContext,
      );

      // 发送 end 信号，携带最终位置 → 框选命中 → confirmSelection
      tool.process(
        {
          signals: [
            { type: "end" },
            {
              type: "position",
              context: { value: new Vector(200, 200) },
            },
          ],
        },
        deviceContext,
      );

      // afterChoose 触发（setContextObjects 后）
      expect(afterChoose).toHaveBeenCalledTimes(1);
      // afterConfirm 触发（confirmSelection 后）
      expect(afterConfirm).toHaveBeenCalledTimes(1);

      const confirmCall = afterConfirm.mock.calls[0];
      expect(confirmCall[0]).toMatchObject({ path: "/monitor/chooser" });
      expect(confirmCall[1]).toEqual([objectInBoard]);
    });
  });
});
