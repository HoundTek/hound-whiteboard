import { DevicesTree, createSubTree } from "../../devices/devices-tree.js";
import { Tool } from "../../tools/tool.js";
import { createPrefixNodeHandler } from "../handler.js";
import {
  createHandoffSubTree,
  wrapCreatorForHandoff,
  wrapFirstForHandoff,
  wrapSubTreeForHandoff,
} from "../handoff-handler.js";
import { PREFIX_NODE_SIGNAL_TYPES } from "../constants.js";
import {
  createMockCreator,
  createMockChooser,
  createMockModifier,
} from "../../test-support/mock-tools.js";

describe("handoff-handler", () => {
  // ─── wrapCreatorForHandoff ───
  test("wrapCreatorForHandoff 应在 completeCreatedObject 后追加 TOOL_COMPLETE", () => {
    const tree = new DevicesTree();
    const creator = createMockCreator((_pkt, ctx) => {
      ctx.setNodeState?.(ctx.eventContext?.path, { objects: [{ id: 1 }] });
    });

    const subTree = createSubTree("/handoff")
      .node("")
      .prefix(
        createPrefixNodeHandler({
          handle(packet, ctx) {
            return packet.signals.some(
              (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
            )
              ? ctx.routeToChild("second")
              : ctx.routeToChild("first");
          },
        }),
      )
      .defaultChild("first")
      .node("first")
      .handler(wrapCreatorForHandoff(creator))
      .end()
      .node("second")
      .handler((_pkt, ctx) => ({
        to: ctx.eventContext.path,
        signals: [{ type: "modified" }],
      }))
      .end()
      .end()
      .build();

    tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });
    const result = tree.dispatch({
      to: "/monitor/handoff",
      signals: [{ type: "position" }],
    });
    expect(result).toEqual([
      { to: "/monitor/handoff/second", signals: [{ type: "modified" }] },
    ]);
  });

  // ─── wrapFirstForHandoff ───
  test("wrapFirstForHandoff 对 creator 应走 completeCreatedObject 路径", () => {
    const tree = new DevicesTree();
    const creator = createMockCreator();

    const subTree = createSubTree("/wf")
      .node("")
      .handler(wrapFirstForHandoff(creator))
      .end()
      .build();

    tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });
    const result = tree.dispatch({
      to: "/monitor/wf",
      signals: [{ type: "position" }],
    });
    expect(
      result.some((p) =>
        p.signals.some(
          (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
        ),
      ),
    ).toBe(true);
  });

  test("wrapFirstForHandoff 对 chooser 应在 end 信号后追加 TOOL_COMPLETE", () => {
    const tree = new DevicesTree();
    const chooser = createMockChooser();

    const subTree = createSubTree("/wf")
      .node("")
      .handler(wrapFirstForHandoff(chooser))
      .end()
      .build();

    tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

    const r1 = tree.dispatch({
      to: "/monitor/wf",
      signals: [{ type: "position" }],
    });
    expect(
      r1.some((p) =>
        p.signals.some(
          (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
        ),
      ),
    ).toBe(false);

    const r2 = tree.dispatch({
      to: "/monitor/wf",
      signals: [{ type: "end" }],
    });
    expect(
      r2.some((p) =>
        p.signals.some(
          (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
        ),
      ),
    ).toBe(true);
  });

  // ─── createHandoffSubTree: Tool 实例 ───
  test("createHandoffSubTree 应构建三层结构并支持 first→second 切换", () => {
    const tree = new DevicesTree();
    const first = createMockCreator();
    const second = createMockModifier();

    const subTree = createHandoffSubTree({
      rootPath: "/workflow",
      first,
      second,
    });

    tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

    const root = tree.getNode("/monitor/workflow");
    expect(root).not.toBeNull();
    expect(tree.getNode("/monitor/workflow/first")).not.toBeNull();
    expect(tree.getNode("/monitor/workflow/second")).not.toBeNull();
    expect(root.getSemantics()).toEqual({
      prefix: true,
      prefixKind: "handoff",
      routePolicy: "state-machine",
    });

    tree.dispatch({
      to: "/monitor/workflow",
      signals: [{ type: "position" }],
    });
    expect(tree.getNodeState("/monitor/workflow")).toEqual({
      phase: "second",
      activeChild: "second",
    });
  });

  test("createHandoffSubTree 应自动桥接对象上下文", () => {
    const tree = new DevicesTree();
    const first = createMockCreator((_pkt, ctx) => {
      ctx.setNodeState?.(ctx.eventContext?.path, {
        objects: [{ id: 42, type: "circle" }],
      });
    });
    const second = createMockModifier((_pkt, ctx) => {
      const st = ctx.getNodeState?.(ctx.eventContext?.path);
      if (st?.objects) {
        ctx.setNodeState?.(ctx.eventContext?.path, { ...st, touched: true });
      }
    });

    const subTree = createHandoffSubTree({
      rootPath: "/ce",
      first,
      second,
    });

    tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

    tree.dispatch({
      to: "/monitor/ce",
      signals: [{ type: "position" }],
    });

    expect(tree.getNodeState("/monitor/ce/first")).toEqual({
      objects: [{ id: 42, type: "circle" }],
    });
    expect(tree.getNodeState("/monitor/ce/second")).toEqual({
      objects: [{ id: 42, type: "circle" }],
    });

    tree.dispatch({
      to: "/monitor/ce",
      signals: [{ type: "transform" }],
    });
    expect(tree.getNodeState("/monitor/ce/second")).toEqual({
      objects: [{ id: 42, type: "circle" }],
      touched: true,
    });
  });

  test("createHandoffSubTree 应在 second 返回 TOOL_COMPLETE 后切回 first", () => {
    const tree = new DevicesTree();
    const first = createMockCreator();
    const second = new (class extends Tool {
      process() {
        return {
          to: "..",
          signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
        };
      }
    })();

    const subTree = createHandoffSubTree({
      rootPath: "/toggle",
      first,
      second,
    });

    tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

    tree.dispatch({ to: "/monitor/toggle", signals: [{ type: "position" }] });
    expect(tree.getNodeState("/monitor/toggle")).toEqual({
      phase: "second",
      activeChild: "second",
    });

    tree.dispatch({ to: "/monitor/toggle", signals: [{ type: "transform" }] });
    expect(tree.getNodeState("/monitor/toggle")).toEqual({
      phase: "first",
      activeChild: "first",
    });
  });

  // ─── createHandoffSubTree: chooser 作为 first ───
  test("createHandoffSubTree 应支持 chooser 作为 first", () => {
    const tree = new DevicesTree();
    const first = createMockChooser((_pkt, ctx) => {
      ctx.setNodeState?.(ctx.eventContext?.path, {
        objects: [{ id: 7, type: "stroke" }],
      });
    });
    const second = createMockModifier();

    const subTree = createHandoffSubTree({
      rootPath: "/chooser-flow",
      first,
      second,
    });

    tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

    // Position signal: chooser selects, but no TOOL_COMPLETE (no "end")
    tree.dispatch({
      to: "/monitor/chooser-flow",
      signals: [{ type: "position" }],
    });
    // 初始状态在 prefix 内部 merge，未写入 node state
    expect(tree.getNodeState("/monitor/chooser-flow")).toEqual({});

    // End 信号触发 chooser 的 TOOL_COMPLETE → handoff
    tree.dispatch({
      to: "/monitor/chooser-flow",
      signals: [{ type: "end" }],
    });
    expect(tree.getNodeState("/monitor/chooser-flow")).toEqual({
      phase: "second",
      activeChild: "second",
    });
    expect(tree.getNodeState("/monitor/chooser-flow/second")).toEqual({
      objects: [{ id: 7, type: "stroke" }],
    });
  });

  // ─── createHandoffSubTree: SubTreeDefinition ───
  test("createHandoffSubTree 应支持 SubTreeDefinition 作为 first", () => {
    const tree = new DevicesTree();
    const firstSubTree = createSubTree("/chain")
      .node("")
      .prefix(
        createPrefixNodeHandler({
          handle(_pkt, ctx) {
            ctx.setNodeState?.(ctx.eventContext?.path, {
              objects: [{ id: 99 }],
            });
            return [
              ctx.routeToChild("tool"),
              {
                to: "..",
                signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
              },
            ];
          },
        }),
      )
      .defaultChild("tool")
      .node("tool")
      .handler((_pkt, ctx) => ({
        to: ctx.eventContext.path,
        signals: [{ type: "created" }],
      }))
      .end()
      .end()
      .build();

    const second = createMockModifier();

    const subTree = createHandoffSubTree({
      rootPath: "/nested",
      first: firstSubTree,
      second,
    });

    tree.mountSubTree("/monitor", subTree, { board: {}, monitor: {} });

    expect(tree.getNode("/monitor/nested/first")).not.toBeNull();
    expect(tree.getNode("/monitor/nested/first/tool")).not.toBeNull();

    tree.dispatch({ to: "/monitor/nested", signals: [{ type: "trigger" }] });
    expect(tree.getNodeState("/monitor/nested")).toEqual({
      phase: "second",
      activeChild: "second",
    });
    expect(tree.getNodeState("/monitor/nested/second")).toEqual({
      objects: [{ id: 99 }],
    });
  });

  // ─── wrapSubTreeForHandoff ───
  test("wrapSubTreeForHandoff 应在 end 信号后补 TOOL_COMPLETE 并被父 prefix 消费", () => {
    const tree = new DevicesTree();
    const inner = createSubTree("/inner")
      .node("")
      .handler((_pkt, ctx) => ({
        to: ctx.eventContext.path,
        signals: [{ type: "inner-done" }],
      }))
      .end()
      .build();

    const wrapped = wrapSubTreeForHandoff(inner);
    const outer = createSubTree("/outer")
      .node("")
      .prefix(
        createPrefixNodeHandler({
          handle(packet, ctx) {
            return packet.signals.some(
              (s) => s.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
            )
              ? [{ to: ctx.eventContext.path, signals: [{ type: "handled" }] }]
              : ctx.routeToChild("child");
          },
        }),
      )
      .defaultChild("child")
      .node("child")
      .handler(wrapped.nodes.handler)
      .end()
      .end()
      .build();

    tree.mountSubTree("/monitor", outer, { board: {}, monitor: {} });

    const result = tree.dispatch({
      to: "/monitor/outer",
      signals: [{ type: "end" }],
    });

    expect(
      result.some((p) => p.signals.some((s) => s.type === "inner-done")),
    ).toBe(true);
    expect(
      result.some((p) => p.signals.some((s) => s.type === "handled")),
    ).toBe(true);
  });
});
