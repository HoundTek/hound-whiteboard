import { DevicesDAG, createSubDAG } from "../../devices-dag/index.js";
import {
  createMultiToolPrefixHandler,
  createPrefixNodeHandler,
  createRepeatorPrefixHandler,
} from "../index.js";

describe("prefix-node", () => {
  test("SubDAGNodeBuilder.prefix 应保留 prefix 语义并复用现有 dispatch", () => {
    const dag = new DevicesDAG();
    const _wfb = createSubDAG("/workflow");
    const _wfr = _wfb
      .node()
      .defaultRoute("tool")
      .prefix(
        createPrefixNodeHandler({
          handle(packet, prefixContext) {
            prefixContext.patchState({
              lastSignalCount: packet.signals.length,
            });
            return prefixContext.routeToChild("tool");
          },
        }),
      );
    const _wft = _wfb.node().handler((packet, context) => ({
      packets: [
        {
          to: "",
          signals: [
            {
              type: "handled",
              context: {
                count:
                  context.getNodeState("/monitor/workflow")?.lastSignalCount ??
                  -1,
              },
            },
          ],
        },
      ],
    }));
    _wfb.edge("tool", _wfr, _wft);
    const prefixSubDAG = _wfb.build();

    dag.mountSubDAG("/monitor", prefixSubDAG);

    expect(dag.getNode("/monitor/workflow")?.getSemantics()).toEqual({
      prefix: true,
    });

    const result = dag.dispatch({
      to: "/monitor/workflow",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      { type: "handled", context: { count: 1 } },
    ]);
  });

  test("createMultiToolPrefixHandler 应根据状态机切换活动子节点（通过回调）", () => {
    const dag = new DevicesDAG();
    const trace = [];

    const _hfb = createSubDAG("/handoff");
    const _hfr = _hfb
      .node()
      .defaultRoute("create")
      .prefix(
        createMultiToolPrefixHandler({
          defaultChild: "create",
          initialState: { mode: "create" },
          resolveTransition({ state, prefixContext }) {
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
              acc: {
                onSwitch: switchTo(
                  state.activeChild === "create" ? "edit" : "create",
                ),
              },
            };
          },
        }),
        { routePolicy: "state-machine" },
      );
    const _hfc = _hfb.node().handler((packet, context) => {
      trace.push("create");
      context.acc?.onSwitch?.();
      return { packets: [] };
    });
    const _hfe = _hfb.node().handler((packet, context) => {
      trace.push("edit");
      context.acc?.onSwitch?.();
      return { packets: [{ to: "", signals: packet.signals }] };
    });
    _hfb.edge("create", _hfr, _hfc);
    _hfb.edge("edit", _hfr, _hfe);
    const handoffSubDAG = _hfb.build();

    dag.mountSubDAG("/monitor", handoffSubDAG);

    // 第一次 dispatch：状态为 create，路由到 create 子节点
    dag.dispatch({
      to: "/monitor/handoff",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });
    expect(trace).toEqual(["create"]);

    // 第二次 dispatch：状态已切换为 edit，路由到 edit 子节点
    dag.dispatch({
      to: "/monitor/handoff",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });
    expect(trace).toEqual(["create", "edit"]);

    // 第三次 dispatch：edit 又调用了 onSwitch → 切回 create
    dag.dispatch({
      to: "/monitor/handoff",
      signals: [{ type: "position", context: { value: { x: 5, y: 6 } } }],
    });
    expect(trace).toEqual(["create", "edit", "create"]);
  });

  test("createRepeatorPrefixHandler 应将信号复制分发到多个子节点", () => {
    const dag = new DevicesDAG();
    const toolACalls = [];
    const toolBCalls = [];

    const _rpb = createSubDAG("/repeater");
    const _rpr = _rpb.node().handler(
      createRepeatorPrefixHandler({
        toChildren: ["tool-a", "tool-b"],
      }),
    );
    const _rpa = _rpb.node().handler((packet) => {
      toolACalls.push(packet.signals);
      return { packets: [] };
    });
    const _rpb2 = _rpb.node().handler((packet) => {
      toolBCalls.push(packet.signals);
      return { packets: [] };
    });
    _rpb.edge("tool-a", _rpr, _rpa);
    _rpb.edge("tool-b", _rpr, _rpb2);
    const repeatorSubDAG = _rpb.build();

    dag.mountSubDAG("/monitor", repeatorSubDAG);

    dag.dispatch({
      to: "/monitor/repeater",
      signals: [{ type: "click", acc: { button: 0 } }],
    });

    expect(toolACalls).toHaveLength(1);
    expect(toolBCalls).toHaveLength(1);
    expect(toolACalls[0]).toEqual([{ type: "click", acc: { button: 0 } }]);
    expect(toolBCalls[0]).toEqual([{ type: "click", acc: { button: 0 } }]);
  });
});
