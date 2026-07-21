/**
 * @file 按钮组设备测试
 * @description 验证 button-group 设备的共享状态发布、信号发送与降级行为。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { DevicesDAG } from "../../index.js";
import {
  createButtonGroupDevice,
  BUTTON_GROUP_DEVICE_SIGNAL_TYPES,
} from "../button-group-device.js";
import { SharedStateStore } from "../../../../engine/utils/shared-state-store.js";

const TOOL_SWITCH = BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH;
const ACTIVE_TOOL = "activeTool";

const TOOLS = [{ name: "stroke" }, { name: "circle" }, { name: "select" }];

/**
 * 搭建按钮组设备测试 DAG
 * @param {Object} [options={}] - 配置项
 * @param {SharedStateStore|null} [options.sharedState=null] - 共享状态 store
 * @returns {{ dag: DevicesDAG, device: Object }}
 */
function setup({ sharedState = null } = {}) {
  const dag = new DevicesDAG();
  const device = createButtonGroupDevice({
    tools: TOOLS,
    defaultTool: "stroke",
    stateKey: ACTIVE_TOOL,
  });
  dag.mountSubDAG("/viewport", device);
  if (sharedState) {
    dag.configureNode("/", { services: { sharedState } });
  }
  return { dag, device };
}

/**
 * 向按钮组设备分发 button-press 信号
 * @param {DevicesDAG} dag - 测试 DAG
 * @param {string} toolName - 按钮对应工具名
 * @returns {*} dispatch 结果
 */
function dispatchPress(dag, toolName) {
  return dag.dispatch({
    to: "/viewport",
    signals: [{ type: "button-press", context: { toolName } }],
  });
}

/**
 * 从 dispatch 结果中提取 tool-switch 信号
 * @param {*} result - dispatch 结果
 * @returns {Object|undefined} tool-switch 信号
 */
function findToolSwitchSignal(result) {
  for (const packet of result.packets) {
    const signal = packet.signals.find((s) => s.type === TOOL_SWITCH);
    if (signal) return signal;
  }
  return undefined;
}

describe("createButtonGroupDevice（共享状态模式）", () => {
  test("首次 dispatch 时应向 store 写入默认激活工具", () => {
    const sharedState = new SharedStateStore();
    const { dag } = setup({ sharedState });

    dispatchPress(dag, "stroke");

    expect(sharedState.get(ACTIVE_TOOL)).toBe("stroke");
  });

  test("合法 button-press 应更新 store 中的激活工具", () => {
    const sharedState = new SharedStateStore();
    const subscriber = jest.fn();
    sharedState.subscribe(ACTIVE_TOOL, subscriber);
    const { dag } = setup({ sharedState });

    dispatchPress(dag, "circle");

    expect(sharedState.get(ACTIVE_TOOL)).toBe("circle");
    // 订阅者依次收到默认值初始化与按钮切换两次通知
    expect(subscriber).toHaveBeenNthCalledWith(1, "stroke", ACTIVE_TOOL);
    expect(subscriber).toHaveBeenNthCalledWith(2, "circle", ACTIVE_TOOL);
  });

  test("非法 toolName 不应改变 store", () => {
    const sharedState = new SharedStateStore();
    const { dag } = setup({ sharedState });

    dispatchPress(dag, "circle");
    dispatchPress(dag, "not-a-tool");

    expect(sharedState.get(ACTIVE_TOOL)).toBe("circle");
  });

  test("tool-switch 信号应发往下游且载荷为当前生效值", () => {
    const sharedState = new SharedStateStore();
    const { dag } = setup({ sharedState });

    const first = dispatchPress(dag, "circle");
    expect(findToolSwitchSignal(first)?.context?.activeTool).toBe("circle");

    const second = dispatchPress(dag, "select");
    expect(findToolSwitchSignal(second)?.context?.activeTool).toBe("select");
  });

  test("无 sharedState 时降级：本地跟踪值发信号，不抛错", () => {
    const { dag, device } = setup();

    let result;
    expect(() => {
      result = dispatchPress(dag, "circle");
    }).not.toThrow();

    expect(findToolSwitchSignal(result)?.context?.activeTool).toBe("circle");
    expect(device.getState()).toEqual({ activeTool: "circle" });
  });

  test("getState 应从 store 读取当前激活工具", () => {
    const sharedState = new SharedStateStore();
    const { dag, device } = setup({ sharedState });

    dispatchPress(dag, "select");

    expect(device.getState()).toEqual({ activeTool: "select" });
  });

  test("resetState 应写 store 重置为默认工具并通知订阅者", () => {
    const sharedState = new SharedStateStore();
    const subscriber = jest.fn();
    sharedState.subscribe(ACTIVE_TOOL, subscriber);
    const { dag, device } = setup({ sharedState });

    dispatchPress(dag, "circle");
    device.resetState();

    expect(sharedState.get(ACTIVE_TOOL)).toBe("stroke");
    expect(subscriber).toHaveBeenLastCalledWith("stroke", ACTIVE_TOOL);
    expect(device.getState()).toEqual({ activeTool: "stroke" });
  });

  test("无 sharedState 时 resetState 重置本地跟踪值", () => {
    const { dag, device } = setup();

    dispatchPress(dag, "circle");
    device.resetState();

    expect(device.getState()).toEqual({ activeTool: "stroke" });
  });

  test("两个 button-group 实例使用不同 stateKey 互不干扰", () => {
    const sharedState = new SharedStateStore();
    const dag = new DevicesDAG();
    const primary = createButtonGroupDevice({
      tools: TOOLS,
      defaultTool: "stroke",
      stateKey: "primaryTool",
    });
    const secondary = createButtonGroupDevice({
      tools: TOOLS,
      defaultTool: "select",
      stateKey: "secondaryTool",
    });
    dag.mountSubDAG("/toolbar/primary", primary);
    dag.mountSubDAG("/toolbar/secondary", secondary);
    dag.configureNode("/", { services: { sharedState } });

    // primary 切到 circle，secondary 保持各自默认
    const primaryResult = dag.dispatch({
      to: "/toolbar/primary",
      signals: [{ type: "button-press", context: { toolName: "circle" } }],
    });

    expect(sharedState.get("primaryTool")).toBe("circle");
    expect(sharedState.get("secondaryTool")).toBeUndefined();
    expect(findToolSwitchSignal(primaryResult)?.context?.activeTool).toBe(
      "circle",
    );

    // secondary 首次 dispatch：写入自己的默认值并按自身键发信号，不影响 primaryTool
    const secondaryResult = dag.dispatch({
      to: "/toolbar/secondary",
      signals: [{ type: "button-press", context: { toolName: "select" } }],
    });

    expect(sharedState.get("secondaryTool")).toBe("select");
    expect(sharedState.get("primaryTool")).toBe("circle");
    expect(findToolSwitchSignal(secondaryResult)?.context?.activeTool).toBe(
      "select",
    );

    // 各自的 getState / resetState 也互不影响
    expect(primary.getState()).toEqual({ activeTool: "circle" });
    expect(secondary.getState()).toEqual({ activeTool: "select" });

    secondary.resetState();
    expect(sharedState.get("secondaryTool")).toBe("select");
    expect(sharedState.get("primaryTool")).toBe("circle");
  });

  test("缺少必传选项时应抛 TypeError", () => {
    // 缺 stateKey
    expect(() =>
      createButtonGroupDevice({ tools: TOOLS, defaultTool: "stroke" }),
    ).toThrow(TypeError);
    expect(() =>
      createButtonGroupDevice({
        tools: TOOLS,
        defaultTool: "stroke",
        stateKey: "",
      }),
    ).toThrow(TypeError);
    // 缺 defaultTool
    expect(() =>
      createButtonGroupDevice({ tools: TOOLS, stateKey: ACTIVE_TOOL }),
    ).toThrow(TypeError);
    expect(() =>
      createButtonGroupDevice({
        tools: TOOLS,
        defaultTool: "",
        stateKey: ACTIVE_TOOL,
      }),
    ).toThrow(TypeError);
  });
});
