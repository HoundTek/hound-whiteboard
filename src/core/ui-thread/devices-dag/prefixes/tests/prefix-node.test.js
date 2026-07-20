import { DevicesDAG, createSubDAG } from "../../index.js";
import {
  createPrefixNodeHandler,
  createRepeaterPrefixHandler,
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
                  context.getNodeState("/viewport/workflow")?.lastSignalCount ??
                  -1,
              },
            },
          ],
        },
      ],
    }));
    _wfb.edge("tool", _wfr, _wft);
    const prefixSubDAG = _wfb.build();

    dag.mountSubDAG("/viewport", prefixSubDAG);

    expect(dag.getNode("/viewport/workflow")?.getSemantics()).toEqual({
      prefix: true,
    });

    const result = dag.dispatch({
      to: "/viewport/workflow",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      { type: "handled", context: { count: 1 } },
    ]);
  });

  test("createRepeaterPrefixHandler 应将信号复制分发到多个子节点", () => {
    const dag = new DevicesDAG();
    const toolACalls = [];
    const toolBCalls = [];

    const _rpb = createSubDAG("/repeater");
    const _rpr = _rpb.node().handler(
      createRepeaterPrefixHandler({
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
    const repeaterSubDAG = _rpb.build();

    dag.mountSubDAG("/viewport", repeaterSubDAG);

    dag.dispatch({
      to: "/viewport/repeater",
      signals: [{ type: "click", detail: { button: 0 } }],
    });

    expect(toolACalls).toHaveLength(1);
    expect(toolBCalls).toHaveLength(1);
    expect(toolACalls[0]).toEqual([{ type: "click", detail: { button: 0 } }]);
    expect(toolBCalls[0]).toEqual([{ type: "click", detail: { button: 0 } }]);
  });
});
