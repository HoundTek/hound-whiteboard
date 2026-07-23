import { SharedStateStore } from "../../../../engine/utils/shared-state-store.js";
import { switchTool } from "../switch-tool.js";

describe("switchTool", () => {
  test("有效切换写入 store 并返回 tool-switch 信号", () => {
    const sharedState = new SharedStateStore();

    const result = switchTool({
      sharedState,
      stateKey: "activeTool",
      toolName: "circle",
      allowedTools: ["stroke", "circle"],
    });

    expect(sharedState.get("activeTool")).toBe("circle");
    expect(result.switched).toBe(true);
    expect(result.signal).toEqual({
      type: "tool-switch",
      context: { activeTool: "circle" },
    });
  });

  test("allowedTools 非空且 toolName 不在其中时不写 store、返回未切换", () => {
    const sharedState = new SharedStateStore();

    const result = switchTool({
      sharedState,
      stateKey: "activeTool",
      toolName: "ellipse",
      allowedTools: ["stroke", "circle"],
    });

    expect(sharedState.get("activeTool")).toBeUndefined();
    expect(result.switched).toBe(false);
    expect(result.signal).toBeNull();
  });

  test("allowedTools 为空数组时不校验", () => {
    const sharedState = new SharedStateStore();

    const result = switchTool({
      sharedState,
      stateKey: "activeTool",
      toolName: "anything",
      allowedTools: [],
    });

    expect(sharedState.get("activeTool")).toBe("anything");
    expect(result.switched).toBe(true);
    expect(result.signal).not.toBeNull();
  });

  test("allowedTools 缺省时不校验", () => {
    const sharedState = new SharedStateStore();

    const result = switchTool({
      sharedState,
      stateKey: "activeTool",
      toolName: "anything",
    });

    expect(sharedState.get("activeTool")).toBe("anything");
    expect(result.switched).toBe(true);
    expect(result.signal).not.toBeNull();
  });

  test("无 sharedState 时不写 store 但仍返回 switched 与信号", () => {
    const result = switchTool({
      sharedState: null,
      stateKey: "activeTool",
      toolName: "circle",
      allowedTools: ["stroke", "circle"],
    });

    expect(result.switched).toBe(true);
    expect(result.signal).toEqual({
      type: "tool-switch",
      context: { activeTool: "circle" },
    });
  });
});
