import { jest } from "@jest/globals";
import { ObjectChooserTool } from "../obj-chooser.js";
import { RectangleRange } from "../../../range/index.js";
import { Vector } from "../../../utils/math.js";

describe("ObjectChooserTool", () => {
  function createStateAccess(initialState = {}) {
    let state = { ...initialState };

    return {
      getState() {
        return state;
      },
      setState(path, nextState) {
        state = nextState ?? {};
        return state;
      },
    };
  }

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
      board,
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
    expect(deviceContext.object).toBe(chosenObject);
    expect(deviceContext.objects).toEqual([chosenObject]);
    expect(stateAccess.getState()).toEqual({
      object: chosenObject,
      objects: [chosenObject],
    });
  });

  test("process 可自动在 chooser 下挂载固定 modifier 子工具", () => {
    const chosenObject = { id: 2 };
    const modifierTool = { createProcessor: () => () => undefined };
    const tree = {
      configureNode: jest.fn(),
      mountTool: jest.fn(),
      getNode: jest.fn(() => null),
    };
    const board = {
      activeObjectManager: {
        choose: jest.fn(),
      },
    };
    const stateAccess = createStateAccess();
    const tool = new TestChooserTool({
      chosenObjects: [chosenObject],
      createModifierTool: () => modifierTool,
    });

    tool.process(
      { signals: [{ type: "trigger", context: {} }] },
      {
        board,
        tree,
        path: "/monitor/chooser/tool",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
        monitor: "monitor-context",
      },
    );

    expect(tree.configureNode).toHaveBeenCalledWith("/monitor/chooser/tool", {
      defaultChild: "tool",
    });
    expect(tree.mountTool).toHaveBeenCalledWith(
      "/monitor/chooser/tool/tool",
      modifierTool,
      {
        board,
        monitor: "monitor-context",
      },
    );
  });

  test("已有 modifier 子工具时应继续向默认路径转发", () => {
    const chosenObject = { id: 3 };
    const tool = new TestChooserTool();
    const result = tool.process(
      { signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }] },
      {
        object: chosenObject,
        path: "/monitor/chooser/tool",
        defaultChild: "tool",
        resolvedDefaultChildPath: "/monitor/chooser/tool/tool",
        tree: { getNode: () => ({ path: "/monitor/chooser/tool/tool" }) },
      },
    );

    expect(result).toEqual({
      to: "tool",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
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
      object: chosenObject,
      objects: [chosenObject],
    });
    const deviceContext = {
      board,
      path: "/monitor/chooser/tool",
      object: chosenObject,
      objects: [chosenObject],
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.umount(deviceContext);

    expect(board.activeObjectManager.discard).toHaveBeenCalledWith(
      new Set([chosenObject]),
    );
    expect(deviceContext.object).toBeUndefined();
    expect(deviceContext.objects).toBeUndefined();
    expect(stateAccess.getState()).toEqual({});
  });

  test("collectUiOverlayEntries 在子 modifier 已有对象时不应重复声明 chooser 选择框", () => {
    const chosenObject = { id: 5 };
    const tool = new TestChooserTool();
    const renderer = {
      createCompatSelectionEntriesForObjects: jest.fn(() => ["chooser-overlay"]),
    };

    const suppressed = tool.collectUiOverlayEntries({
      deviceContext: {
        path: "/monitor/chooser/tool",
        object: chosenObject,
        objects: [chosenObject],
        tree: {
          resolveDefaultLeaf: () => ({
            path: "/monitor/chooser/tool/tool",
            state: { object: chosenObject, objects: [chosenObject] },
          }),
        },
      },
      renderer,
    });

    expect(suppressed).toEqual([]);
    expect(renderer.createCompatSelectionEntriesForObjects).not.toHaveBeenCalled();

    const visible = tool.collectUiOverlayEntries({
      deviceContext: {
        path: "/monitor/chooser/tool",
        object: chosenObject,
        objects: [chosenObject],
        tree: {
          resolveDefaultLeaf: () => ({
            path: "/monitor/chooser/tool",
            state: { object: chosenObject, objects: [chosenObject] },
          }),
        },
      },
      renderer,
    });

    expect(visible).toEqual(["chooser-overlay"]);
    expect(renderer.createCompatSelectionEntriesForObjects).toHaveBeenCalledWith(
      [chosenObject],
      "chooser",
    );
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
});
