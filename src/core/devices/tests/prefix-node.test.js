import { DevicesTree, createSubTree } from "../devices-tree.js";
import {
  createMultiToolPrefixHandler,
  createPrefixNodeHandler,
  PREFIX_NODE_SIGNAL_TYPES,
} from "../prefix-node.js";

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

    tree.mountDevice("/monitor", prefixSubTree);

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

    tree.mountDevice("/monitor", handoffSubTree);

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

    tree.mountDevice("/monitor", nestedSubTree);

    expect(tree.getNode("/monitor/nested/handoff")?.getSemantics()).toEqual({
      prefix: true,
    });
    expect(tree.getNode("/monitor/nested/handoff/create")).not.toBeNull();
  });
});