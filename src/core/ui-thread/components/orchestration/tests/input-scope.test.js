/**
 * @file InputScope 测试
 * @description 验证 mountWorkflow 将工具挂载到 workflows 下任意嵌套路径的完整契约。
 * @module core/ui-thread/components/orchestration/tests/input-scope.test
 * @author Zhou Chenyu
 *
 * @jest-environment node
 */

import { jest } from "@jest/globals";

import { createSubDAG, DevicesDAG } from "../../../devices-dag/index.js";
import { CollectingTool } from "../../../../test-support/mock-tools.js";
import { InputScope } from "../input-scope.js";

/**
 * 创建独立的 InputScope 测试环境（真实 DevicesDAG + 桩 board/viewport）
 * @returns {{ dag: DevicesDAG, scope: InputScope }}
 */
function createScope() {
  const dag = new DevicesDAG();
  const board = { devicesDAG: dag };
  const viewport = { viewportId: "vp" };
  return { dag, scope: new InputScope(board, viewport) };
}

describe("InputScope.mountWorkflow", () => {
  test("应将工具挂载到 workflows 下的任意嵌套路径并走完整契约", () => {
    const { dag, scope } = createScope();
    const tool = new CollectingTool();

    const node = scope.mountWorkflow("tool-switcher/stroke", tool);

    expect(node.path).toBe("/vp/workflows/tool-switcher/stroke");
    expect(typeof node.handler).toBe("function");
    expect(node.semantics.tool).toBe(true);

    dag.dispatch({
      to: "/vp/workflows/tool-switcher/stroke",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });
    expect(tool.calls).toHaveLength(1);
  });

  test("同一工具实例重复挂载应抛错", () => {
    const { scope } = createScope();
    const tool = new CollectingTool();

    scope.mountWorkflow("a", tool);
    expect(() => scope.mountWorkflow("b", tool)).toThrow(/already mounted/);
  });

  test("目标节点已有 handler 时应抛错", () => {
    const { scope } = createScope();

    scope.mountWorkflow("a", new CollectingTool());
    expect(() => scope.mountWorkflow("a", new CollectingTool())).toThrow(
      /already has a handler/,
    );
  });

  test("卸载应触发 processor.dispose 与 tool.umount 钩子链", () => {
    const { dag, scope } = createScope();
    const tool = new CollectingTool();
    tool.umount = jest.fn();

    scope.mountWorkflow("tool-switcher/stroke", tool);
    dag.unmount("/vp/workflows/tool-switcher/stroke", {});

    expect(tool.umount).toHaveBeenCalledTimes(1);
  });

  test("卸载后同一工具实例可重新挂载", () => {
    const { dag, scope } = createScope();
    const tool = new CollectingTool();

    scope.mountWorkflow("a", tool);
    dag.unmount("/vp/workflows/a", {});

    expect(() => scope.mountWorkflow("b", tool)).not.toThrow();
  });

  test("应支持将 SubDAGDefinition 挂载到嵌套路径", () => {
    const { dag, scope } = createScope();
    const calls = [];
    const builder = createSubDAG("/");
    builder.node().handler((pkt) => {
      calls.push(pkt.signals.map((s) => s.type));
    });

    const nodes = scope.mountWorkflow("sub/work", builder.build());

    expect(nodes.length).toBeGreaterThan(0);
    dag.dispatch({ to: "/vp/workflows/sub/work", signals: [{ type: "go" }] });
    expect(calls).toEqual([["go"]]);
  });

  test("非法名称应抛 TypeError", () => {
    const { scope } = createScope();

    expect(() => scope.mountWorkflow("", new CollectingTool())).toThrow(
      TypeError,
    );
    expect(() => scope.mountWorkflow(null, new CollectingTool())).toThrow(
      TypeError,
    );
  });
});
