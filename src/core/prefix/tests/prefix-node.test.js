import { DevicesTree, createSubTree } from "../../devices/devices-tree.js";
import {
  createMultiToolPrefixHandler,
  createPrefixNodeHandler,
  createRepeatorPrefixHandler,
  PREFIX_NODE_SIGNAL_TYPES,
} from "../index.js";

describe("prefix-node", () => {
  test("SubTreeNodeBuilder.prefix 应保留 prefix 语义并复用现有 dispatch", () => {
    const tree = new DevicesTree();
    const prefixSubTree = createSubTree("/workflow")
      .node("")
      .prefix(
        createPrefixNodeHandler({
          handle(packet, prefixContext) {
            prefixContext.patchState({ lastSignalCount: packet.signals.length });
            return prefixContext.routeToChild("tool");
          },
        }),
      )
      .defaultChild("tool")
      .end()
      .node("tool")
      .handler((packet, context) => ({
        to: context.eventContext.path,
        signals: [
          {
            type: "handled",
            context: {
              count:
                context.getNodeState("/monitor/workflow")?.lastSignalCount ?? -1,
            },
          },
        ],
      }))
      .end()
      .build();

    tree.mountSubTree("/monitor", prefixSubTree);

    expect(tree.getNode("/monitor/workflow")?.getSemantics()).toEqual({
      prefix: true,
    });

    expect(
      tree.dispatch({
        to: "/monitor/workflow",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      }),
    ).toEqual([
      {
        to: "/monitor/workflow/tool",
        signals: [{ type: "handled", context: { count: 1 } }],
      },
    ]);
  });

  test("createMultiToolPrefixHandler 应根据状态机切换活动子节点", () => {
    const tree = new DevicesTree();
    const trace = [];

    const handoffSubTree = createSubTree("/handoff")
      .node("")
      .prefix(
        createMultiToolPrefixHandler({
          defaultChild: "create",
          initialState: { mode: "create" },
          resolveTransition({ signalPacket, state }) {
            const hasCompleteSignal = signalPacket.signals.some(
              (signal) => signal.type === PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE,
            );

            if (!hasCompleteSignal) {
              return { child: state.activeChild };
            }

            if (state.activeChild === "create") {
              return {
                patchState: {
                  mode: "edit",
                  activeChild: "edit",
                },
                consume: true,
              };
            }

            return {
              patchState: {
                mode: "create",
                activeChild: "create",
              },
              consume: true,
            };
          },
        }),
        { routePolicy: "state-machine" },
      )
      .defaultChild("create")
      .end()
      .node("create")
      .handler(() => {
        trace.push("create");
        return {
          to: "..",
          signals: [{ type: PREFIX_NODE_SIGNAL_TYPES.TOOL_COMPLETE }],
        };
      })
      .end()
      .node("edit")
      .handler((packet, context) => {
        trace.push("edit");
        return {
          to: context.eventContext.path,
          signals: packet.signals,
        };
      })
      .end()
      .build();

    tree.mountSubTree("/monitor", handoffSubTree);

    expect(tree.getNode("/monitor/handoff")?.getSemantics()).toEqual({
      prefix: true,
      routePolicy: "state-machine",
    });

    expect(
      tree.dispatch({
        to: "/monitor/handoff",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      }),
    ).toEqual([]);
    expect(tree.getNodeState("/monitor/handoff")).toEqual({
      activeChild: "edit",
      mode: "edit",
    });

    expect(
      tree.dispatch({
        to: "/monitor/handoff",
        signals: [{ type: "transform", context: { value: { a: 1, d: 1 } } }],
      }),
    ).toEqual([
      {
        to: "/monitor/handoff/edit",
        signals: [{ type: "transform", context: { value: { a: 1, d: 1 } } }],
      },
    ]);
    expect(trace).toEqual(["create", "edit"]);
  });

  test("嵌套 SubTreeNodeBuilder.node 应按父节点层级构建输入子树", () => {
    const tree = new DevicesTree();
    const nestedSubTree = createSubTree("/nested")
      .node("")
      .node("handoff")
      .prefix(
        createPrefixNodeHandler({
          handle(packet, prefixContext) {
            return prefixContext.routeToChild("create", packet.signals);
          },
        }),
      )
      .node("create")
      .handler((packet, context) => ({
        to: context.eventContext.path,
        signals: packet.signals,
      }))
      .end()
      .end()
      .end()
      .build();

    tree.mountSubTree("/monitor", nestedSubTree);

    expect(tree.getNode("/monitor/nested/handoff")?.getSemantics()).toEqual({
      prefix: true,
    });
    expect(tree.getNode("/monitor/nested/handoff/create")).not.toBeNull();
  });

  test("createRepeatorPrefixHandler 应把信号复制两份发往同一 child", () => {
    const tree = new DevicesTree();
    const trace = [];

    const repeatorSubTree = createSubTree("/repeator-dup")
      .node("")
      .prefix(
        createRepeatorPrefixHandler({
          toChildren: ["tool", "tool"],
        }),
        { prefixKind: "repeator", routePolicy: "fan-out" },
      )
      .defaultChild("tool")
      .end()
      .node("tool")
      .handler((packet) => {
        trace.push(packet.signals);
        return {
          to: "/monitor/repeator-dup/tool",
          signals: [{ type: "done" }],
        };
      })
      .end()
      .build();

    tree.mountSubTree("/monitor", repeatorSubTree);

    tree.dispatch({
      to: "/monitor/repeator-dup",
      signals: [{ type: "input", context: { value: 42 } }],
    });

    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual([{ type: "input", context: { value: 42 } }]);
    expect(trace[1]).toEqual([{ type: "input", context: { value: 42 } }]);
  });

  test("createRepeatorPrefixHandler 应把信号复制后分叉到多个不同 child", () => {
    const tree = new DevicesTree();
    const traceA = [];
    const traceB = [];

    const forkSubTree = createSubTree("/fork")
      .node("")
      .prefix(
        createRepeatorPrefixHandler({
          toChildren: ["branch-a", "branch-b"],
        }),
      )
      .defaultChild("branch-a")
      .end()
      .node("branch-a")
      .handler((packet) => {
        traceA.push(packet.signals);
        return {
          to: "/monitor/fork/branch-a",
          signals: [{ type: "done-a" }],
        };
      })
      .end()
      .node("branch-b")
      .handler((packet) => {
        traceB.push(packet.signals);
        return {
          to: "/monitor/fork/branch-b",
          signals: [{ type: "done-b" }],
        };
      })
      .end()
      .build();

    tree.mountSubTree("/monitor", forkSubTree);

    tree.dispatch({
      to: "/monitor/fork",
      signals: [{ type: "split", context: { id: 1 } }],
    });

    expect(traceA).toHaveLength(1);
    expect(traceA[0]).toEqual([{ type: "split", context: { id: 1 } }]);
    expect(traceB).toHaveLength(1);
    expect(traceB[0]).toEqual([{ type: "split", context: { id: 1 } }]);
  });
});
