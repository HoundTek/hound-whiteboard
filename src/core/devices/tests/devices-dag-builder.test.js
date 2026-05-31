import { jest } from "@jest/globals";
import {
  DevicesDAG,
  DevicesDAGNode,
  DevicesDAGEdge,
  createSubDAG,
} from "../devices-dag.js";
import { SignalPacket } from "../signal.js";

describe("createSubDAG (Builder DSL)", () => {
  test("应构建基本子图并挂载到 DevicesDAG", () => {
    const dag = new DevicesDAG();

    const builder = createSubDAG("/keyboard");
    const r = builder.node().handler(() => {});
    const c = builder.node().handler(() => {});
    const s = builder.node();
    builder.edge("code", r, c);
    builder.edge("Space", c, s);

    const def = builder.build();
    expect(def.rootPath).toBe("/keyboard");
    expect(def.rootNodeId).toBe(0);
    expect(def.nodes.size).toBe(3);
    expect(def.edges).toHaveLength(2);

    dag.mountSubDAG("", def);
    expect(dag.getNode("/keyboard")).toBeInstanceOf(DevicesDAGNode);
    expect(dag.getNode("/keyboard/code")).toBeInstanceOf(DevicesDAGNode);
    expect(dag.getNode("/keyboard/code/Space")).toBeInstanceOf(DevicesDAGNode);
  });

  test("应支持 DAG：多条边指向同一节点", () => {
    const dag = new DevicesDAG();
    const builder = createSubDAG("/dag-demo");
    const root = builder.node().handler(() => {});
    const shared = builder.node();
    builder.edge("primary", root, shared);
    builder.edge("secondary", root, shared); // DAG: 两条边指向同一节点

    dag.mountSubDAG("", builder.build());

    const primaryNode = dag.getNode("/dag-demo/primary");
    const secondaryNode = dag.getNode("/dag-demo/secondary");
    expect(primaryNode).toBe(secondaryNode);
  });

  test("node().tool() 应标记 semantics.tool", () => {
    const mockTool = { createProcessor: () => () => {} };
    const builder = createSubDAG("/tools");
    const t = builder.node().tool(mockTool);
    builder.build();

    const nodeDef = builder.build().nodes.get(t._localId);
    expect(nodeDef.tool).toBe(mockTool);
    expect(nodeDef.semantics.tool).toBe(true);
  });

  test("node().prefix() 应设置 handler 并标记 semantics.prefix", () => {
    const handler = () => {};
    const builder = createSubDAG("/prefixed");
    const p = builder.node().prefix(handler, { extra: true });
    builder.build();

    const nodeDef = builder.build().nodes.get(p._localId);
    expect(nodeDef.handler).toBe(handler);
    expect(nodeDef.semantics.prefix).toBe(true);
    expect(nodeDef.semantics.extra).toBe(true);
  });

  test("node().defaultRoute() 应设置默认出边名", () => {
    const builder = createSubDAG("/routed");
    const r = builder.node().defaultRoute("next");
    builder.build();

    const nodeDef = builder.build().nodes.get(r._localId);
    expect(nodeDef.defaultRoute).toBe("next");
  });

  test("node().umount() 应设置卸载钩子", () => {
    const cleanup = () => {};
    const builder = createSubDAG("/cleanable");
    const n = builder.node().umount(cleanup);
    builder.build();

    const nodeDef = builder.build().nodes.get(n._localId);
    expect(nodeDef.umount).toBe(cleanup);
  });

  test("edge() 参数非 NodeBuilder 实例时应抛错", () => {
    const builder = createSubDAG("/bad");
    expect(() => builder.edge("e", {}, {})).toThrow(TypeError);
  });
});
