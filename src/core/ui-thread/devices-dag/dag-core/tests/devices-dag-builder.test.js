import { jest } from "@jest/globals";
import {
  DevicesDAG,
  DevicesDAGNode,
  DevicesDAGEdge,
  createSubDAG,
} from "../../index.js";
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

  describe("expose()", () => {
    test("expose() 应将函数注册到 build() 输出中", () => {
      const builder = createSubDAG("/exposed");
      builder.node();
      const getState = () => ({ count: 0 });
      const resetState = () => {};
      builder.expose({ getState, resetState });

      const def = builder.build();
      expect(def.getState).toBe(getState);
      expect(def.resetState).toBe(resetState);
    });

    test("expose() 应忽略非函数值", () => {
      const builder = createSubDAG("/exposed");
      builder.node();
      builder.expose({ validFn: () => {}, notFn: "string", alsoNot: 42 });

      const def = builder.build();
      expect(def.validFn).toBeInstanceOf(Function);
      expect(def).not.toHaveProperty("notFn");
      expect(def).not.toHaveProperty("alsoNot");
    });

    test("expose() 无参调用不应抛错", () => {
      const builder = createSubDAG("/exposed");
      builder.node();
      expect(() => builder.expose()).not.toThrow();
      expect(() => builder.build()).not.toThrow();
    });
  });

  describe("label()", () => {
    test("label() 为 no-op，不应影响构建", () => {
      const builder = createSubDAG("/labeled");
      const n = builder
        .node()
        .handler(() => {})
        .label("my-node");
      builder.build();

      const def = builder.build();
      const nodeDef = def.nodes.get(n._localId);
      expect(nodeDef.handler).toBeInstanceOf(Function);
    });
  });

  describe("handler() 边界值", () => {
    test("handler(null) 应设置 null handler", () => {
      const builder = createSubDAG("/null-handler");
      const n = builder.node().handler(null);
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.handler).toBeNull();
    });

    test("handler(非函数) 应设为 null", () => {
      const builder = createSubDAG("/bad-handler");
      const n = builder.node().handler("not-a-function");
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.handler).toBeNull();
    });
  });

  describe("defaultRoute() 边界值", () => {
    test("defaultRoute() 无参应设为空字符串", () => {
      const builder = createSubDAG("/empty-route");
      const n = builder.node().defaultRoute();
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.defaultRoute).toBe("");
    });

    test("defaultRoute(非字符串) 应设为空字符串", () => {
      const builder = createSubDAG("/non-string-route");
      const n = builder.node().defaultRoute(123);
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.defaultRoute).toBe("");
    });
  });

  describe("umount() 边界值", () => {
    test("umount(null) 应设置 null", () => {
      const builder = createSubDAG("/null-umount");
      const n = builder.node().umount(null);
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.umount).toBeNull();
    });

    test("umount(非函数) 应设为 null", () => {
      const builder = createSubDAG("/bad-umount");
      const n = builder.node().umount("not-a-function");
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.umount).toBeNull();
    });
  });

  describe("tool() 边界值", () => {
    test("tool() 无 toolContext 应使用空对象", () => {
      const mockTool = { createProcessor: () => () => {} };
      const builder = createSubDAG("/no-ctx");
      const n = builder.node().tool(mockTool);
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.toolContext).toEqual({});
    });

    test("tool() 传入非纯对象 toolContext 应使用空对象", () => {
      const mockTool = { createProcessor: () => () => {} };
      const builder = createSubDAG("/bad-ctx");
      const n = builder.node().tool(mockTool, "not-object");
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.toolContext).toEqual({});
    });
  });

  describe("prefix() 边界值", () => {
    test("prefix() 无 semantics 应只标记 prefix", () => {
      const handler = () => {};
      const builder = createSubDAG("/prefix-only");
      const n = builder.node().prefix(handler);
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.semantics.prefix).toBe(true);
    });

    test("prefix() 传入非纯对象 semantics 应只标记 prefix", () => {
      const handler = () => {};
      const builder = createSubDAG("/prefix-bad-sem");
      const n = builder.node().prefix(handler, "not-object");
      builder.build();

      const nodeDef = builder.build().nodes.get(n._localId);
      expect(nodeDef.semantics.prefix).toBe(true);
      expect(nodeDef.semantics).not.toHaveProperty("not-object");
    });
  });

  describe("createSubDAG() 边界值", () => {
    test("createSubDAG() 无参应默认根路径为 /", () => {
      const builder = createSubDAG();
      builder.node();
      const def = builder.build();
      expect(def.rootPath).toBe("/");
    });
  });

  describe("DAG 边管理边界值", () => {
    test("edge() 应链式返回 DAGBuilder", () => {
      const builder = createSubDAG("/chain");
      const r = builder.node();
      const c = builder.node();
      const result = builder.edge("e", r, c);
      expect(result).toBe(builder);
    });

    test("edge() 只有源非 NodeBuilder 时应抛错", () => {
      const builder = createSubDAG("/bad");
      const valid = builder.node();
      expect(() => builder.edge("e", {}, valid)).toThrow(TypeError);
    });

    test("edge() 只有目标非 NodeBuilder 时应抛错", () => {
      const builder = createSubDAG("/bad");
      const valid = builder.node();
      expect(() => builder.edge("e", valid, {})).toThrow(TypeError);
    });
  });

  describe("build() 空子图", () => {
    test("无任何 node() 调用的 build() 应返回有效定义", () => {
      const builder = createSubDAG("/empty");
      const def = builder.build();
      expect(def.rootPath).toBe("/empty");
      expect(def.rootNodeId).toBe(0);
      expect(def.nodes.size).toBe(0);
      expect(def.edges).toEqual([]);
    });
  });
});
