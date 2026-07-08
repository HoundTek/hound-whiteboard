/**
 * @file 手势工具基类测试
 * @description 验证 GestureTool 与 MultiGestureTool 的统一手势/动作编排语义。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { GestureTool, MultiGestureTool } from "../gesture-tool.js";

/**
 * 将 Vector 或普通位置对象规整为可断言结构
 * @param {{ x: number, y: number }|null|undefined} position - 位置对象
 * @returns {{ x: number, y: number }|null}
 */
function serializePosition(position) {
  if (!position) {
    return null;
  }
  return { x: position.x, y: position.y };
}

/**
 * 单手势测试工具
 * @class
 * @extends GestureTool
 */
class TestGestureTool extends GestureTool {
  /**
   * 生命周期调用记录
   * @type {Array<Array<*>>}
   */
  calls = [];

  /**
   * begin 准入开关
   * @type {boolean}
   */
  allowBegin = true;

  /**
   * 对象保障开关
   * @type {boolean}
   */
  allowEnsureObject = true;

  /**
   * beforeAction 开关
   * @type {boolean}
   */
  allowAction = true;

  /**
   * 当前动作返回值
   * @type {*}
   */
  actionResult = "done";

  /**
   * 动作完成事件监听器
   * @type {import("@jest/globals").Mock}
   */
  actionCompleteListener = jest.fn();

  constructor() {
    super();
    this.on("action:complete", this.actionCompleteListener);
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   * @returns {boolean}
   */
  canBeginGesture(interaction) {
    this.calls.push(["canBegin", serializePosition(interaction.position)]);
    return this.allowBegin;
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   * @returns {boolean}
   * @protected
   */
  _ensureObject(interaction) {
    this.calls.push(["ensureObject", serializePosition(interaction.position)]);
    return this.allowEnsureObject;
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   */
  beginGesture(interaction) {
    this.calls.push(["begin", serializePosition(interaction.position)]);
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   */
  updateGesture(interaction) {
    this.calls.push(["update", serializePosition(interaction.position)]);
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   */
  completeGesture(interaction) {
    this.calls.push([
      "completeGesture",
      serializePosition(interaction.position),
    ]);
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   */
  cancelGesture(interaction) {
    this.calls.push(["cancelGesture", serializePosition(interaction.position)]);
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   */
  beforeAction(context) {
    this.calls.push(["beforeAction", context.path ?? ""]);
    return this.allowAction;
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {*}
   */
  performAction(context) {
    this.calls.push(["performAction", context.path ?? ""]);
    return this.actionResult;
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {*} result - 动作结果
   */
  afterAction(context, result) {
    this.calls.push(["afterAction", context.path ?? "", result]);
    super.afterAction(context, result);
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   */
  discardAction(context) {
    this.calls.push(["discardAction", context.path ?? ""]);
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   */
  clearOverlayState(context = {}) {
    this.calls.push(["clearOverlayState", context.path ?? ""]);
  }

  /**
   * @returns {void}
   */
  reset() {
    this.calls = [];
    this.actionCompleteListener.mockClear();
    super.reset();
  }
}

/**
 * 多手势测试工具
 * @class
 * @extends MultiGestureTool
 */
class TestMultiGestureTool extends MultiGestureTool {
  /**
   * 生命周期调用记录
   * @type {Array<Array<*>>}
   */
  calls = [];

  /**
   * begin 准入开关
   * @type {boolean}
   */
  allowBegin = true;

  /**
   * 对象保障开关
   * @type {boolean}
   */
  allowEnsureObject = true;

  /**
   * beforeAction 开关
   * @type {boolean}
   */
  allowAction = true;

  /**
   * 当前动作返回值
   * @type {*}
   */
  actionResult = "done";

  /**
   * 动作完成事件监听器
   * @type {import("@jest/globals").Mock}
   */
  actionCompleteListener = jest.fn();

  constructor() {
    super();
    this.autoActionOnGestureEnd = false;
    this.on("action:complete", this.actionCompleteListener);
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   * @returns {boolean}
   */
  canBeginGesture(interaction) {
    this.calls.push(["canBegin", serializePosition(interaction.position)]);
    return this.allowBegin;
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   * @returns {boolean}
   * @protected
   */
  _ensureObject(interaction) {
    this.calls.push(["ensureObject", serializePosition(interaction.position)]);
    return this.allowEnsureObject;
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   */
  beginGesture(interaction) {
    this.calls.push(["begin", serializePosition(interaction.position)]);
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   */
  updateGesture(interaction) {
    this.calls.push(["update", serializePosition(interaction.position)]);
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   */
  completeGesture(interaction) {
    this.calls.push([
      "completeGesture",
      serializePosition(interaction.position),
    ]);
  }

  /**
   * @param {import("../gesture-tool.js").GestureInteraction} interaction - 当前手势交互上下文
   */
  cancelGesture(interaction) {
    this.calls.push(["cancelGesture", serializePosition(interaction.position)]);
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   */
  beforeAction(context) {
    this.calls.push(["beforeAction", context.path ?? ""]);
    return this.allowAction;
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {*}
   */
  performAction(context) {
    this.calls.push(["performAction", context.path ?? ""]);
    return this.actionResult;
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {*} result - 动作结果
   */
  afterAction(context, result) {
    this.calls.push(["afterAction", context.path ?? "", result]);
    super.afterAction(context, result);
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   */
  discardAction(context) {
    this.calls.push(["discardAction", context.path ?? ""]);
  }

  /**
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   */
  clearOverlayState(context = {}) {
    this.calls.push(["clearOverlayState", context.path ?? ""]);
  }

  /**
   * @returns {void}
   */
  reset() {
    this.calls = [];
    this.actionCompleteListener.mockClear();
    super.reset();
  }
}

/**
 * 创建基础 handler 上下文
 * @param {Object} [overrides={}] - 覆写项
 * @returns {Object}
 */
function createContext(overrides = {}) {
  return {
    path: "/gesture-test",
    acc: {},
    ...overrides,
  };
}

describe("GestureTool", () => {
  test("buildInteraction 应优先使用 context.resolvePosition 解析位置", () => {
    const tool = new TestGestureTool();
    const packet = {
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    };
    const context = createContext({
      resolvePosition: jest.fn(() => ({ x: 11, y: 22 })),
    });

    const interaction = tool.buildInteraction(packet, context);

    expect(context.resolvePosition).toHaveBeenCalledTimes(1);
    expect(serializePosition(interaction.position)).toEqual({ x: 11, y: 22 });
    expect(interaction.hasCancel).toBe(false);
    expect(interaction.hasEnd).toBe(false);
  });

  test("首个 position 应触发 canBegin → ensureObject → begin → update", () => {
    const tool = new TestGestureTool();
    const beginListener = jest.fn();
    const updateListener = jest.fn();
    tool.on("gesture:begin", beginListener);
    tool.on("gesture:update", updateListener);

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      },
      createContext(),
    );

    expect(tool.calls).toEqual([
      ["canBegin", { x: 3, y: 4 }],
      ["ensureObject", { x: 3, y: 4 }],
      ["begin", { x: 3, y: 4 }],
      ["update", { x: 3, y: 4 }],
    ]);
    expect(beginListener).toHaveBeenCalledTimes(1);
    expect(updateListener).toHaveBeenCalledTimes(1);
    expect(tool.isGestureActive).toBe(true);
  });

  test("ensureObject 返回 false 时不应进入 begin/update", () => {
    const tool = new TestGestureTool();
    tool.allowEnsureObject = false;

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 5, y: 6 } } }],
      },
      createContext(),
    );

    expect(tool.calls).toEqual([
      ["canBegin", { x: 5, y: 6 }],
      ["ensureObject", { x: 5, y: 6 }],
    ]);
    expect(tool.isGestureActive).toBe(false);
  });

  test("end 信号在默认模式下应结束手势并自动触发 completeAction", () => {
    const tool = new TestGestureTool();
    const endListener = jest.fn();
    tool.on("gesture:end", endListener);

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 8, y: 9 } } }],
      },
      createContext(),
    );
    tool.process({ signals: [{ type: "end" }] }, createContext());

    expect(tool.calls).toEqual([
      ["canBegin", { x: 8, y: 9 }],
      ["ensureObject", { x: 8, y: 9 }],
      ["begin", { x: 8, y: 9 }],
      ["update", { x: 8, y: 9 }],
      ["completeGesture", null],
      ["clearOverlayState", "/gesture-test"],
      ["beforeAction", "/gesture-test"],
      ["performAction", "/gesture-test"],
      ["afterAction", "/gesture-test", "done"],
    ]);
    expect(endListener).toHaveBeenCalledTimes(1);
    expect(tool.actionCompleteListener).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/gesture-test" }),
      "done",
    );
    expect(tool.isGestureActive).toBe(false);
  });

  test("autoActionOnGestureEnd = false 时 end 仅结束手势不提交动作", () => {
    const tool = new TestGestureTool();
    tool.autoActionOnGestureEnd = false;

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 2, y: 3 } } }],
      },
      createContext(),
    );
    tool.process({ signals: [{ type: "end" }] }, createContext());

    expect(tool.calls).toEqual([
      ["canBegin", { x: 2, y: 3 }],
      ["ensureObject", { x: 2, y: 3 }],
      ["begin", { x: 2, y: 3 }],
      ["update", { x: 2, y: 3 }],
      ["completeGesture", null],
    ]);
    expect(tool.actionCompleteListener).not.toHaveBeenCalled();
    expect(tool.isGestureActive).toBe(false);
  });

  test("cancel 信号应取消手势并丢弃动作", () => {
    const tool = new TestGestureTool();
    const cancelListener = jest.fn();
    tool.on("gesture:cancel", cancelListener);

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 1, y: 1 } } }],
      },
      createContext(),
    );
    tool.process({ signals: [{ type: "cancel" }] }, createContext());

    expect(tool.calls).toEqual([
      ["canBegin", { x: 1, y: 1 }],
      ["ensureObject", { x: 1, y: 1 }],
      ["begin", { x: 1, y: 1 }],
      ["update", { x: 1, y: 1 }],
      ["cancelGesture", null],
      ["clearOverlayState", "/gesture-test"],
      ["discardAction", "/gesture-test"],
    ]);
    expect(cancelListener).toHaveBeenCalledTimes(1);
    expect(tool.isGestureActive).toBe(false);
  });

  test("success 信号应结束手势并显式触发 completeAction", () => {
    const tool = new TestGestureTool();
    tool.autoActionOnGestureEnd = false;

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 7, y: 8 } } }],
      },
      createContext(),
    );
    tool.process({ signals: [{ type: "success" }] }, createContext());

    expect(tool.calls).toEqual([
      ["canBegin", { x: 7, y: 8 }],
      ["ensureObject", { x: 7, y: 8 }],
      ["begin", { x: 7, y: 8 }],
      ["update", { x: 7, y: 8 }],
      ["completeGesture", null],
      ["clearOverlayState", "/gesture-test"],
      ["beforeAction", "/gesture-test"],
      ["performAction", "/gesture-test"],
      ["afterAction", "/gesture-test", "done"],
    ]);
    expect(tool.actionCompleteListener).toHaveBeenCalledTimes(1);
    expect(tool.isGestureActive).toBe(false);
  });

  test("object-end/object-cancel 在单手势模式下应分别等价于 end/cancel", () => {
    const endTool = new TestGestureTool();
    endTool.process(
      {
        signals: [{ type: "position", context: { value: { x: 4, y: 4 } } }],
      },
      createContext(),
    );
    endTool.process({ signals: [{ type: "object-end" }] }, createContext());

    expect(endTool.calls.slice(-5)).toEqual([
      ["completeGesture", null],
      ["clearOverlayState", "/gesture-test"],
      ["beforeAction", "/gesture-test"],
      ["performAction", "/gesture-test"],
      ["afterAction", "/gesture-test", "done"],
    ]);

    const cancelTool = new TestGestureTool();
    cancelTool.process(
      {
        signals: [{ type: "position", context: { value: { x: 4, y: 5 } } }],
      },
      createContext(),
    );
    cancelTool.process(
      { signals: [{ type: "object-cancel" }] },
      createContext(),
    );

    expect(cancelTool.calls.slice(-3)).toEqual([
      ["cancelGesture", null],
      ["clearOverlayState", "/gesture-test"],
      ["discardAction", "/gesture-test"],
    ]);
  });
});

describe("MultiGestureTool", () => {
  test("end 信号在多手势模式下仅结束当前手势，不触发动作", () => {
    const tool = new TestMultiGestureTool();

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 9, y: 1 } } }],
      },
      createContext(),
    );
    tool.process({ signals: [{ type: "end" }] }, createContext());

    expect(tool.calls).toEqual([
      ["canBegin", { x: 9, y: 1 }],
      ["ensureObject", { x: 9, y: 1 }],
      ["begin", { x: 9, y: 1 }],
      ["update", { x: 9, y: 1 }],
      ["completeGesture", null],
    ]);
    expect(tool.actionCompleteListener).not.toHaveBeenCalled();
    expect(tool.isGestureActive).toBe(false);
  });

  test("object-end 信号在多手势模式下应提交动作", () => {
    const tool = new TestMultiGestureTool();

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 6, y: 6 } } }],
      },
      createContext(),
    );
    tool.process({ signals: [{ type: "object-end" }] }, createContext());

    expect(tool.calls).toEqual([
      ["canBegin", { x: 6, y: 6 }],
      ["ensureObject", { x: 6, y: 6 }],
      ["begin", { x: 6, y: 6 }],
      ["update", { x: 6, y: 6 }],
      ["completeGesture", null],
      ["clearOverlayState", "/gesture-test"],
      ["beforeAction", "/gesture-test"],
      ["performAction", "/gesture-test"],
      ["afterAction", "/gesture-test", "done"],
    ]);
    expect(tool.actionCompleteListener).toHaveBeenCalledTimes(1);
    expect(tool.isGestureActive).toBe(false);
  });

  test("cancel 与 object-cancel 在多手势模式下应分离处理", () => {
    const cancelTool = new TestMultiGestureTool();
    cancelTool.process(
      {
        signals: [{ type: "position", context: { value: { x: 3, y: 7 } } }],
      },
      createContext(),
    );
    cancelTool.process({ signals: [{ type: "cancel" }] }, createContext());

    expect(cancelTool.calls).toEqual([
      ["canBegin", { x: 3, y: 7 }],
      ["ensureObject", { x: 3, y: 7 }],
      ["begin", { x: 3, y: 7 }],
      ["update", { x: 3, y: 7 }],
      ["cancelGesture", null],
    ]);

    const objectCancelTool = new TestMultiGestureTool();
    objectCancelTool.process(
      {
        signals: [{ type: "position", context: { value: { x: 8, y: 2 } } }],
      },
      createContext(),
    );
    objectCancelTool.process(
      { signals: [{ type: "object-cancel" }] },
      createContext(),
    );

    expect(objectCancelTool.calls).toEqual([
      ["canBegin", { x: 8, y: 2 }],
      ["ensureObject", { x: 8, y: 2 }],
      ["begin", { x: 8, y: 2 }],
      ["update", { x: 8, y: 2 }],
      ["cancelGesture", null],
      ["clearOverlayState", "/gesture-test"],
      ["discardAction", "/gesture-test"],
    ]);
  });
});
