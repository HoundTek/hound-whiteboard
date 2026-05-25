import { jest } from "@jest/globals";
import { ObjectChooserTool } from "../obj-chooser.js";

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
    const deviceContext = {
      board,
      nodeContext: {},
    };
    const tool = new TestChooserTool({ chosenObjects: [chosenObject] });

    tool.process({ signals: [{ type: "trigger", context: {} }] }, deviceContext);

    expect(board.activeObjectManager.choose).toHaveBeenCalledWith(
      new Set([chosenObject]),
    );
    expect(deviceContext.object).toBe(chosenObject);
    expect(deviceContext.objects).toEqual([chosenObject]);
    expect(deviceContext.nodeContext.object).toBe(chosenObject);
    expect(deviceContext.nodeContext.objects).toEqual([chosenObject]);
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
        nodeContext: {},
        monitor: "monitor-context",
      },
    );

    expect(tree.configureNode).toHaveBeenCalledWith(
      "/monitor/chooser/tool",
      { defaultPath: "tool" },
    );
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
        nodeContext: { object: chosenObject },
        defaultPath: "tool",
        resolvedDefaultPath: "/monitor/chooser/tool/tool",
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
    const deviceContext = {
      board,
      object: chosenObject,
      objects: [chosenObject],
      nodeContext: {
        object: chosenObject,
        objects: [chosenObject],
      },
    };

    tool.umount(deviceContext);

    expect(board.activeObjectManager.discard).toHaveBeenCalledWith(
      new Set([chosenObject]),
    );
    expect(deviceContext.object).toBeUndefined();
    expect(deviceContext.objects).toBeUndefined();
    expect(deviceContext.nodeContext.object).toBeUndefined();
    expect(deviceContext.nodeContext.objects).toBeUndefined();
  });
});