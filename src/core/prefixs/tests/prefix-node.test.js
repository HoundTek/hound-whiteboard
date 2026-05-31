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
            prefixContext.patchState({
              lastSignalCount: packet.signals.length,
            });
            return prefixContext.routeToChild("tool");
          },
        }),
      )
      .defaultChild("tool")
      .end()
      .node("tool")
      .handler((packet, context) => ({
        packets: [
          {
            to: "",
            signals: [
              {
                type: "handled",
                context: {
                  count:
                    context.getNodeState("/monitor/workflow")
                      ?.lastSignalCount ?? -1,
                },
              },
            ],
          },
        ],
      }))
      .end()
      .build();

    tree.mountSubTree("/monitor", prefixSubTree);

    expect(tree.getNode("/monitor/workflow")?.getSemantics()).toEqual({
      prefix: true,
    });

    const result = tree.dispatch({
      to: "/monitor/workflow",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      { type: "handled", context: { count: 1 } },
    ]);
  });

  test("createMultiToolPrefixHandler 应根据状态机切换活动子节点（通过回调）", () => {
    const tree = new DevicesTree();
    const trace = [];

    const handoffSubTree = createSubTree("/handoff")
      .node("")
      .prefix(
        createMultiToolPrefixHandler({
          defaultChild: "create",
          initialState: { mode: "create" },
          resolveTransition({ state, prefixContext }) {
            // 注入回调到上下文，子节点调用以触发状态切换
            const switchTo = (target) => () => {
              if (target === "edit") {
                prefixContext.setState({
                  mode: "edit",
                  activeChild: "edit",
                });
              } else {
                prefixContext.setState({
                  mode: "create",
                  activeChild: "create",
                });
              }
            };

            return {
              child: state.activeChild,
              context: {
                onSwitch: switchTo(
                  state.activeChild === "create" ? "edit" : "create",
                ),
              },
            };
          },
        }),
        { routePolicy: "state-machine" },
      )
      .defaultChild("create")
      .end()
      .node("create")
      .handler((packet, context) => {
        trace.push("create");
        context.context?.onSwitch?.();
        return { packets: [] };
      })
      .end()
      .node("edit")
      .handler((packet, context) => {
        trace.push("edit");
        context.context?.onSwitch?.();
        return { packets: [{ to: "", signals: packet.signals }] };
      })
      .end()
      .build();

    tree.mountSubTree("/monitor", handoffSubTree);

    // 第一次 dispatch：状态为 create，路由到 create 子节点
    tree.dispatch({
      to: "/monitor/handoff",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });
    expect(trace).toEqual(["create"]);

    // 第二次 dispatch：状态已切换为 edit，路由到 edit 子节点
    tree.dispatch({
      to: "/monitor/handoff",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });
    expect(trace).toEqual(["create", "edit"]);

    // 第三次 dispatch：edit 又调用了 onSwitch → 切回 create
    tree.dispatch({
      to: "/monitor/handoff",
      signals: [{ type: "position", context: { value: { x: 5, y: 6 } } }],
    });
    expect(trace).toEqual(["create", "edit", "create"]);
  });

  test("createRepeatorPrefixHandler 应将信号复制分发到多个子节点", () => {
    const tree = new DevicesTree();
    const toolACalls = [];
    const toolBCalls = [];

    const repeatorSubTree = createSubTree("/repeater")
      .node("")
      .handler(
        createRepeatorPrefixHandler({
          toChildren: ["tool-a", "tool-b"],
        }),
      )
      .end()
      .node("tool-a")
      .handler((packet) => {
        toolACalls.push(packet.signals);
        return { packets: [] };
      })
      .end()
      .node("tool-b")
      .handler((packet) => {
        toolBCalls.push(packet.signals);
        return { packets: [] };
      })
      .end()
      .build();

    tree.mountSubTree("/monitor", repeatorSubTree);

    tree.dispatch({
      to: "/monitor/repeater",
      signals: [{ type: "click", context: { button: 0 } }],
    });

    expect(toolACalls).toHaveLength(1);
    expect(toolBCalls).toHaveLength(1);
    expect(toolACalls[0]).toEqual([{ type: "click", context: { button: 0 } }]);
    expect(toolBCalls[0]).toEqual([{ type: "click", context: { button: 0 } }]);
  });
});
