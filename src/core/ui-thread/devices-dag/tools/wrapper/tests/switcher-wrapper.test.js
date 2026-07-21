/**
 * @file ToolSwitcherWrapper 测试
 * @description 验证 1-of-N 互斥路由、tool-switch 切换、懒实例化与状态镜像。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { DevicesDAG } from "../../../index.js";
import { ToolSwitcherWrapper } from "../switcher-wrapper.js";
import { BUTTON_GROUP_DEVICE_SIGNAL_TYPES } from "../../../devices/button-group-device.js";
import { CollectingTool } from "../../../../../test-support/mock-tools.js";

const TOOL_SWITCH = BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH;

/**
 * 挂载 switcher wrapper 到测试 DAG
 * @param {ToolSwitcherWrapper} wrapper - switcher 实例
 * @returns {{ dag: DevicesDAG, wrapper: ToolSwitcherWrapper }}
 */
function mountSwitcher(wrapper) {
  const dag = new DevicesDAG();
  dag.mountWorkflow("/switcher", wrapper);
  dag.configureNode("/", { services: { board: {}, viewport: {} } });
  return { dag, wrapper };
}

/**
 * 向 switcher 入口分发信号
 * @param {DevicesDAG} dag - 测试 DAG
 * @param {Array<Object>} signals - 信号列表
 * @returns {*} dispatch 结果
 */
function dispatchToSwitcher(dag, signals) {
  return dag.dispatch({ to: "/switcher", signals });
}

describe("ToolSwitcherWrapper", () => {
  describe("构造校验", () => {
    test("空工具列表应抛错", () => {
      expect(() => new ToolSwitcherWrapper({ tools: [] })).toThrow(TypeError);
    });

    test("条目缺少 name 或 tool/createTool 未二选一应抛错", () => {
      expect(
        () => new ToolSwitcherWrapper({ tools: [{ tool: new CollectingTool() }] }),
      ).toThrow(TypeError);
      expect(
        () =>
          new ToolSwitcherWrapper({
            tools: [{ name: "a", tool: new CollectingTool(), createTool: () => new CollectingTool() }],
          }),
      ).toThrow(TypeError);
      expect(() => new ToolSwitcherWrapper({ tools: [{ name: "a" }] })).toThrow(
        TypeError,
      );
    });

    test("tool 不是 Tool 实例时应抛错", () => {
      expect(
        () => new ToolSwitcherWrapper({ tools: [{ name: "a", tool: {} }] }),
      ).toThrow(TypeError);
    });

    test("缺少 defaultTool 时应抛错", () => {
      expect(
        () =>
          new ToolSwitcherWrapper({
            tools: [{ name: "a", tool: new CollectingTool() }],
          }),
      ).toThrow(TypeError);
    });

    test("defaultTool 不在工具列表中时应抛错", () => {
      expect(
        () =>
          new ToolSwitcherWrapper({
            tools: [{ name: "a", tool: new CollectingTool() }],
            defaultTool: "b",
          }),
      ).toThrow(TypeError);
    });
  });

  test("常规信号默认路由到 defaultTool 的子工具", () => {
    const stroke = new CollectingTool();
    const circle = new CollectingTool();
    const wrapper = new ToolSwitcherWrapper({
      tools: [
        { name: "stroke", tool: stroke },
        { name: "circle", tool: circle },
      ],
      defaultTool: "stroke",
    });
    const { dag } = mountSwitcher(wrapper);

    dispatchToSwitcher(dag, [
      { type: "position", context: { value: { x: 10, y: 20 } } },
    ]);

    expect(stroke.calls).toHaveLength(1);
    expect(stroke.calls[0].signalPacket.signals[0].type).toBe("position");
    expect(circle.calls).toHaveLength(0);
  });

  test("tool-switch 信号切换路由目标，旧工具收到 endAction，信号本身不向下转发", () => {
    const stroke = new CollectingTool();
    const circle = new CollectingTool();
    const strokeEndAction = jest.spyOn(stroke, "endAction");
    const wrapper = new ToolSwitcherWrapper({
      tools: [
        { name: "stroke", tool: stroke },
        { name: "circle", tool: circle },
      ],
      defaultTool: "stroke",
    });
    const { dag } = mountSwitcher(wrapper);

    dispatchToSwitcher(dag, [
      { type: "position", context: { value: { x: 10, y: 20 } } },
    ]);
    dispatchToSwitcher(dag, [
      { type: TOOL_SWITCH, context: { activeTool: "circle" } },
    ]);

    // 旧工具收到 endAction；tool-switch 信号本身不转发给任何子工具
    expect(strokeEndAction).toHaveBeenCalledTimes(1);
    expect(stroke.calls).toHaveLength(1);
    expect(circle.calls).toHaveLength(0);
    expect(wrapper.getDebugInfo().activeName).toBe("circle");

    // 切换后新工具接收常规信号，旧工具不再收到
    dispatchToSwitcher(dag, [
      { type: "position", context: { value: { x: 30, y: 40 } } },
    ]);
    expect(circle.calls).toHaveLength(1);
    expect(stroke.calls).toHaveLength(1);
  });

  test("切换到相同工具或未知工具时不触发 endAction", () => {
    const stroke = new CollectingTool();
    const circle = new CollectingTool();
    const strokeEndAction = jest.spyOn(stroke, "endAction");
    const wrapper = new ToolSwitcherWrapper({
      tools: [
        { name: "stroke", tool: stroke },
        { name: "circle", tool: circle },
      ],
      defaultTool: "stroke",
    });
    const { dag } = mountSwitcher(wrapper);

    dispatchToSwitcher(dag, [
      { type: TOOL_SWITCH, context: { activeTool: "stroke" } },
    ]);
    dispatchToSwitcher(dag, [
      { type: TOOL_SWITCH, context: { activeTool: "unknown" } },
    ]);

    expect(strokeEndAction).not.toHaveBeenCalled();
    expect(wrapper.getDebugInfo().activeName).toBe("stroke");

    // 路由目标未变，常规信号仍到 stroke
    dispatchToSwitcher(dag, [
      { type: "position", context: { value: { x: 1, y: 1 } } },
    ]);
    expect(stroke.calls).toHaveLength(1);
  });

  test("createTool 工厂在首次激活前不被调用（懒实例化）", () => {
    const stroke = new CollectingTool();
    const circle = new CollectingTool();
    const circleFactory = jest.fn(() => circle);
    const wrapper = new ToolSwitcherWrapper({
      tools: [
        { name: "stroke", tool: stroke },
        { name: "circle", createTool: circleFactory },
      ],
      defaultTool: "stroke",
    });
    const { dag } = mountSwitcher(wrapper);

    // 激活前：工厂未调用，仅 stroke 槽位已实例化
    expect(circleFactory).not.toHaveBeenCalled();
    expect(wrapper.getDebugInfo().instantiatedSlots).toEqual(["stroke"]);

    dispatchToSwitcher(dag, [
      { type: TOOL_SWITCH, context: { activeTool: "circle" } },
    ]);

    // 首次激活时实例化
    expect(circleFactory).toHaveBeenCalledTimes(1);
    expect(wrapper.getDebugInfo().instantiatedSlots).toEqual([
      "stroke",
      "circle",
    ]);

    dispatchToSwitcher(dag, [
      { type: "position", context: { value: { x: 5, y: 6 } } },
    ]);
    expect(circle.calls).toHaveLength(1);
  });

  test("routeTarget 镜像到节点 state 供外部观察", () => {
    const stroke = new CollectingTool();
    const circle = new CollectingTool();
    const wrapper = new ToolSwitcherWrapper({
      tools: [
        { name: "stroke", tool: stroke },
        { name: "circle", tool: circle },
      ],
      defaultTool: "stroke",
    });
    const { dag } = mountSwitcher(wrapper);

    // 首个常规信号后镜像初始路由目标
    dispatchToSwitcher(dag, [
      { type: "position", context: { value: { x: 1, y: 1 } } },
    ]);
    expect(dag.getNodeState("/switcher").routeTarget).toBe("stroke");

    dispatchToSwitcher(dag, [
      { type: TOOL_SWITCH, context: { activeTool: "circle" } },
    ]);
    expect(dag.getNodeState("/switcher").routeTarget).toBe("circle");
  });

  test("reset 恢复默认路由目标且保留已实例化槽位", () => {
    const stroke = new CollectingTool();
    const circle = new CollectingTool();
    const wrapper = new ToolSwitcherWrapper({
      tools: [
        { name: "stroke", tool: stroke },
        { name: "circle", tool: circle },
      ],
      defaultTool: "stroke",
    });
    const { dag } = mountSwitcher(wrapper);

    dispatchToSwitcher(dag, [
      { type: TOOL_SWITCH, context: { activeTool: "circle" } },
    ]);
    expect(wrapper.getDebugInfo().activeName).toBe("circle");

    wrapper.reset();

    expect(wrapper.getDebugInfo().activeName).toBe("stroke");
    expect(wrapper.getDebugInfo().instantiatedSlots).toEqual([
      "stroke",
      "circle",
    ]);

    dispatchToSwitcher(dag, [
      { type: "position", context: { value: { x: 1, y: 1 } } },
    ]);
    expect(stroke.calls).toHaveLength(1);
    expect(circle.calls).toHaveLength(0);
  });
});
