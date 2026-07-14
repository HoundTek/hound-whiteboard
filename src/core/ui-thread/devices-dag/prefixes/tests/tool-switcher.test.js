/**
 * @file tool-switcher prefix 测试
 * @description 验证 createToolSwitcherSubDAG 的路由切换、end-action 收尾和状态管理行为。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { DevicesDAG } from "../../index.js";
import { createToolSwitcherSubDAG } from "../index.js";
import { BUTTON_GROUP_DEVICE_SIGNAL_TYPES } from "../../devices/button-group-device.js";

/**
 * 搭建测试用 tool-switcher DAG
 * @param {Array<{name: string}>} tools - 工具列表
 * @param {string} defaultTool - 默认工具名
 * @returns {{ dag: DevicesDAG, toolCalls: Object, switcherSubDAG: Object }}
 */
function setupSwitcher(tools, defaultTool) {
  const dag = new DevicesDAG();
  const switcherSubDAG = createToolSwitcherSubDAG({ tools, defaultTool });
  dag.mountSubDAG("/switcher", switcherSubDAG);

  /** @type {Record<string, Array<{ signals: Array, path: string }>>} */
  const toolCalls = {};

  for (const { name } of tools) {
    toolCalls[name] = [];
    const toolPath = `/switcher/${name}/tool`;
    dag.addEdge(`/switcher/${name}`, "default", toolPath);
    dag.configureNode(toolPath, {
      handler: (packet) => {
        toolCalls[name].push({
          signals: packet.signals,
          path: toolPath,
        });
      },
    });
  }

  return { dag, toolCalls, switcherSubDAG };
}

describe("createToolSwitcherSubDAG", () => {
  test("常规信号应转发到默认工具", () => {
    const { dag, toolCalls } = setupSwitcher(
      [{ name: "stroke" }, { name: "circle" }],
      "stroke",
    );

    dag.dispatch({
      to: "/switcher",
      signals: [
        { type: "position", context: { value: { x: 10, y: 20 } } },
      ],
    });

    expect(toolCalls.stroke).toHaveLength(1);
    expect(toolCalls.stroke[0].signals[0].type).toBe("position");
    expect(toolCalls.circle).toHaveLength(0);
  });

  test("切换工具时应向旧工具发送 end-action", () => {
    const { dag, toolCalls } = setupSwitcher(
      [{ name: "stroke" }, { name: "circle" }],
      "stroke",
    );

    // 先向 stroke 发送常规信号
    dag.dispatch({
      to: "/switcher",
      signals: [
        { type: "position", context: { value: { x: 10, y: 20 } } },
      ],
    });
    expect(toolCalls.stroke).toHaveLength(1);

    // 切换到 circle
    dag.dispatch({
      to: "/switcher",
      signals: [
        {
          type: BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
          context: { activeTool: "circle" },
        },
      ],
    });

    // 旧工具 stroke 应收到 end-action
    expect(toolCalls.stroke).toHaveLength(2);
    expect(toolCalls.stroke[1].signals[0].type).toBe("end-action");

    // 新工具 circle 此时不应收到任何信号
    expect(toolCalls.circle).toHaveLength(0);
  });

  test("切换后新工具应接收常规信号，旧工具不再收到", () => {
    const { dag, toolCalls } = setupSwitcher(
      [{ name: "stroke" }, { name: "circle" }],
      "stroke",
    );

    // 切换到 circle
    dag.dispatch({
      to: "/switcher",
      signals: [
        {
          type: BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
          context: { activeTool: "circle" },
        },
      ],
    });

    // stroke 收到 end-action
    expect(toolCalls.stroke).toHaveLength(1);
    expect(toolCalls.stroke[0].signals[0].type).toBe("end-action");

    // 发送常规信号
    dag.dispatch({
      to: "/switcher",
      signals: [
        { type: "position", context: { value: { x: 30, y: 40 } } },
      ],
    });

    // circle 应收到常规信号
    expect(toolCalls.circle).toHaveLength(1);
    expect(toolCalls.circle[0].signals[0].type).toBe("position");

    // stroke 不应再收到
    expect(toolCalls.stroke).toHaveLength(1);
  });

  test("切换到相同工具不应发送 end-action", () => {
    const { dag, toolCalls } = setupSwitcher(
      [{ name: "stroke" }, { name: "circle" }],
      "stroke",
    );

    // 先发送常规信号
    dag.dispatch({
      to: "/switcher",
      signals: [
        { type: "position", context: { value: { x: 10, y: 20 } } },
      ],
    });
    expect(toolCalls.stroke).toHaveLength(1);

    // 切换到相同工具（stroke → stroke）
    dag.dispatch({
      to: "/switcher",
      signals: [
        {
          type: BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
          context: { activeTool: "stroke" },
        },
      ],
    });

    // 不应有额外调用
    expect(toolCalls.stroke).toHaveLength(1);
  });

  test("连续多次切换应正确收尾和路由", () => {
    const { dag, toolCalls } = setupSwitcher(
      [{ name: "stroke" }, { name: "circle" }, { name: "select" }],
      "stroke",
    );

    // stroke → circle
    dag.dispatch({
      to: "/switcher",
      signals: [
        {
          type: BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
          context: { activeTool: "circle" },
        },
      ],
    });
    expect(toolCalls.stroke).toHaveLength(1);
    expect(toolCalls.stroke[0].signals[0].type).toBe("end-action");

    // 向 circle 发送信号
    dag.dispatch({
      to: "/switcher",
      signals: [
        { type: "position", context: { value: { x: 1, y: 1 } } },
      ],
    });
    expect(toolCalls.circle).toHaveLength(1);

    // circle → select
    dag.dispatch({
      to: "/switcher",
      signals: [
        {
          type: BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
          context: { activeTool: "select" },
        },
      ],
    });
    expect(toolCalls.circle).toHaveLength(2);
    expect(toolCalls.circle[1].signals[0].type).toBe("end-action");

    // 向 select 发送信号
    dag.dispatch({
      to: "/switcher",
      signals: [
        { type: "position", context: { value: { x: 2, y: 2 } } },
      ],
    });
    expect(toolCalls.select).toHaveLength(1);

    // select → stroke
    dag.dispatch({
      to: "/switcher",
      signals: [
        {
          type: BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
          context: { activeTool: "stroke" },
        },
      ],
    });
    expect(toolCalls.select).toHaveLength(2);
    expect(toolCalls.select[1].signals[0].type).toBe("end-action");
  });

  test("tool-switch 信号不应被转发到子工具", () => {
    const { dag, toolCalls } = setupSwitcher(
      [{ name: "stroke" }, { name: "circle" }],
      "stroke",
    );

    // 发送 tool-switch 信号
    dag.dispatch({
      to: "/switcher",
      signals: [
        {
          type: BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
          context: { activeTool: "circle" },
        },
      ],
    });

    // stroke 只收到 end-action，不收到 tool-switch 信号
    expect(toolCalls.stroke).toHaveLength(1);
    expect(toolCalls.stroke[0].signals[0].type).toBe("end-action");

    // circle 不应收到 tool-switch 信号
    expect(toolCalls.circle).toHaveLength(0);
  });

  test("getRouteTarget / setRouteTarget / resetState 应正常工作", () => {
    const switcherSubDAG = createToolSwitcherSubDAG({
      tools: [{ name: "stroke" }, { name: "circle" }],
      defaultTool: "stroke",
    });

    expect(switcherSubDAG.getRouteTarget()).toBe("stroke");

    switcherSubDAG.setRouteTarget("circle");
    expect(switcherSubDAG.getRouteTarget()).toBe("circle");

    switcherSubDAG.resetState();
    expect(switcherSubDAG.getRouteTarget()).toBe("stroke");
  });

  test("无工具时常规信号应被 stop", () => {
    const dag = new DevicesDAG();
    const switcherSubDAG = createToolSwitcherSubDAG({
      tools: [],
    });
    dag.mountSubDAG("/switcher", switcherSubDAG);

    const result = dag.dispatch({
      to: "/switcher",
      signals: [
        { type: "position", context: { value: { x: 10, y: 20 } } },
      ],
    });

    // 无路由目标时 stop，返回空 packets
    expect(result.packets).toHaveLength(0);
  });

  test("routeTarget 应同步到节点状态供外部观察", () => {
    const { dag } = setupSwitcher(
      [{ name: "stroke" }, { name: "circle" }],
      "stroke",
    );

    // 初始状态为空（handler 尚未被调用）
    expect(dag.getNodeState("/switcher")).toEqual({});

    // 发送常规信号后，routeTarget 同步到节点状态
    dag.dispatch({
      to: "/switcher",
      signals: [
        { type: "position", context: { value: { x: 1, y: 1 } } },
      ],
    });
    expect(dag.getNodeState("/switcher").routeTarget).toBe("stroke");

    // 切换后 routeTarget 更新
    dag.dispatch({
      to: "/switcher",
      signals: [
        {
          type: BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
          context: { activeTool: "circle" },
        },
      ],
    });
    expect(dag.getNodeState("/switcher").routeTarget).toBe("circle");
  });
});
