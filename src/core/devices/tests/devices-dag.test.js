import { jest } from "@jest/globals";
import {
  DevicesDAG,
  DevicesDAGNode,
  DevicesDAGEdge,
  createSubDAG,
} from "../devices-dag.js";
import { SignalPacket } from "../signal.js";

// =========================================================================
// DevicesDAG 核心测试
// =========================================================================

describe("DevicesDAG", () => {
  // -----------------------------------------------------------------------
  // 构造与根节点
  // -----------------------------------------------------------------------

  test("构造后应存在唯一根节点 /", () => {
    const dag = new DevicesDAG();
    const root = dag.getNode("/");
    expect(root).toBeInstanceOf(DevicesDAGNode);
    expect(root.id).toBe(0);
    expect(root.semantics).toEqual({ root: true });
  });

  test("getNode('/') 应返回根节点", () => {
    const dag = new DevicesDAG();
    expect(dag.getNode("/").id).toBe(0);
  });

  test("getNode 对不存在的路径应返回 undefined", () => {
    const dag = new DevicesDAG();
    expect(dag.getNode("/nonexistent")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // ensureNode — 自动创建缺失边和节点
  // -----------------------------------------------------------------------

  test("ensureNode 应自动创建缺失路径上的边和节点", () => {
    const dag = new DevicesDAG();
    const node = dag.ensureNode("/mouse/primary");

    expect(node).toBeInstanceOf(DevicesDAGNode);
    expect(node.id).toBeGreaterThan(0);

    // 验证路径可解析
    expect(dag.getNode("/mouse")).toBeInstanceOf(DevicesDAGNode);
    expect(dag.getNode("/mouse/primary")).toBe(node);
  });

  test("ensureNode 对已存在路径应返回已有节点（幂等）", () => {
    const dag = new DevicesDAG();
    const a = dag.ensureNode("/a/b");
    const b = dag.ensureNode("/a/b");
    expect(a).toBe(b);
  });

  test("ensureNode('/') 应返回根节点", () => {
    const dag = new DevicesDAG();
    expect(dag.ensureNode("/")).toBe(dag.getNode("/"));
  });

  // -----------------------------------------------------------------------
  // 边管理
  // -----------------------------------------------------------------------

  test("addEdge 应在两个节点之间创建有向边", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a");
    const edge = dag.addEdge("/a", "to-b");

    expect(edge).toBeInstanceOf(DevicesDAGEdge);
    expect(edge.name).toBe("to-b");
    expect(dag.getNode("/a/to-b")).toBeInstanceOf(DevicesDAGNode);
  });

  test("addEdge 应支持指定目标路径", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a");
    dag.ensureNode("/b-target");
    dag.addEdge("/a", "to-b", "/b-target");

    expect(dag.getNode("/a/to-b")).toBe(dag.getNode("/b-target"));
  });

  test("addEdge 在同源节点下不允许边名重复", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a");
    dag.addEdge("/a", "dup");

    expect(() => dag.addEdge("/a", "dup")).toThrow(/already exists/);
  });

  test("addEdge 在不同源节点下允许相同边名", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a");
    dag.ensureNode("/b");
    dag.addEdge("/a", "same");
    dag.addEdge("/b", "same");

    expect(dag.getNode("/a/same")).toBeInstanceOf(DevicesDAGNode);
    expect(dag.getNode("/b/same")).toBeInstanceOf(DevicesDAGNode);
    expect(dag.getNode("/a/same")).not.toBe(dag.getNode("/b/same"));
  });

  // -----------------------------------------------------------------------
  // DAG 特性：多路径到达同一节点
  // -----------------------------------------------------------------------

  test("一个节点可以有多条入边（DAG 核心特性）", () => {
    const dag = new DevicesDAG();
    const shared = dag.ensureNode("/shared");

    dag.addEdge("/", "route-a", "/shared");
    dag.addEdge("/", "route-b", "/shared");

    expect(dag.getNode("/route-a")).toBe(shared);
    expect(dag.getNode("/route-b")).toBe(shared);

    // ensureNode 已创建 "shared" 边（1条）+ addEdge 两条 = 3 条入边
    expect(shared.inEdges.size).toBe(3);

    // 不同源下可以有同名边指向同一节点
    dag.ensureNode("/other-src");
    dag.addEdge("/other-src", "to-shared", "/shared");
    expect(shared.inEdges.size).toBe(4);
  });

  // -----------------------------------------------------------------------
  // 边移除 + 孤立节点递归清理
  // -----------------------------------------------------------------------

  test("removeEdge 应移除边但保留仍有入边的目标节点", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/shared");
    dag.addEdge("/", "a", "/shared");
    dag.addEdge("/", "b", "/shared");

    expect(dag.removeEdge("/", "a")).toBe(true);
    expect(dag.getNode("/a")).toBeUndefined(); // 路径消失
    expect(dag.getNode("/b")).toBe(dag.getNode("/shared")); // 另一条路径仍在
    expect(dag.getNode("/shared")).toBeInstanceOf(DevicesDAGNode);
  });

  test("removeEdge 应递归清理失去最后入边的孤立下游子图", () => {
    const dag = new DevicesDAG();
    const leaf = dag.ensureNode("/a/b/c");
    const nodeB = dag.getNode("/a/b");
    const nodeA = dag.getNode("/a");

    // a 只有从根的一条入边
    expect(dag.removeEdge("/", "a")).toBe(true);

    // 整条链都应不可达
    expect(dag.getNode("/a")).toBeUndefined();
    expect(dag.getNode("/a/b")).toBeUndefined();
    expect(dag.getNode("/a/b/c")).toBeUndefined();

    // 节点表应清理
    expect(dag._nodes.has(nodeA.id)).toBe(false);
    expect(dag._nodes.has(nodeB.id)).toBe(false);
    expect(dag._nodes.has(leaf.id)).toBe(false);
  });

  test("removeEdge 不能移除不存在的边", () => {
    const dag = new DevicesDAG();
    expect(dag.removeEdge("/", "nope")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 节点状态
  // -----------------------------------------------------------------------

  test("getNodeState / setNodeState 应按路径读写节点状态", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a");

    dag.setNodeState("/a", { count: 5, label: "test" });
    expect(dag.getNodeState("/a")).toEqual({ count: 5, label: "test" });
  });

  test("getNodeState / setNodeState 应按节点 id 读写", () => {
    const dag = new DevicesDAG();
    const node = dag.ensureNode("/x");
    dag.setNodeState(node.id, { flag: true });
    expect(dag.getNodeState(node.id)).toEqual({ flag: true });
  });

  test("getNodeState 对不存在节点返回空对象", () => {
    const dag = new DevicesDAG();
    expect(dag.getNodeState("/nowhere")).toEqual({});
    expect(dag.getNodeState(999)).toEqual({});
  });

  test("setNodeState 应返回写入后的状态快照", () => {
    const dag = new DevicesDAG();
    const result = dag.setNodeState("/s", { a: 1 });
    expect(result).toEqual({ a: 1 });
  });

  test("多路径到达同一节点时状态应共享", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/shared");
    dag.addEdge("/", "via-a", "/shared");
    dag.addEdge("/", "via-b", "/shared");

    dag.setNodeState("/via-a", { value: 42 });

    // 通过另一路径读取应看到相同状态
    expect(dag.getNodeState("/via-b")).toEqual({ value: 42 });
    expect(dag.getNodeState("/shared")).toEqual({ value: 42 });
  });

  // -----------------------------------------------------------------------
  // 节点配置
  // -----------------------------------------------------------------------

  test("configureNode 应更新节点 handler / semantics / defaultRoute / umount", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a");

    const handler = () => {};
    const umount = () => {};

    dag.configureNode("/a", {
      handler,
      semantics: { prefix: true },
      defaultRoute: "next",
      umount,
    });

    const node = dag.getNode("/a");
    expect(node.handler).toBe(handler);
    expect(node.semantics).toEqual({ prefix: true });
    expect(node.defaultRoute).toBe("next");
    expect(node.umount).toBe(umount);
  });

  test("configureNode 传 null 可清空 handler 和 umount", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a");
    dag.configureNode("/a", { handler: () => {}, umount: () => {} });
    dag.configureNode("/a", { handler: null, umount: null });

    const node = dag.getNode("/a");
    expect(node.handler).toBeNull();
    expect(node.umount).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 分发（基础）
  // -----------------------------------------------------------------------

  test("dispatch 应沿路径逐段调用 handler", () => {
    const dag = new DevicesDAG();
    const calls = [];

    dag.ensureNode("/mouse/primary");
    dag.configureNode("/mouse", {
      handler(pkt, ctx) {
        calls.push({ path: ctx.path, signals: pkt.signals.map((s) => s.type) });
      },
    });
    dag.configureNode("/mouse/primary", {
      handler(pkt, ctx) {
        calls.push({ path: ctx.path, signals: pkt.signals.map((s) => s.type) });
      },
    });

    dag.dispatch({
      to: "/mouse/primary",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(calls).toEqual([
      { path: "/mouse", signals: ["position"] },
      { path: "/mouse/primary", signals: ["position"] },
    ]);
  });

  test("dispatch 路径不存在时应静默终止", () => {
    const dag = new DevicesDAG();
    const handler = jest.fn();
    dag.ensureNode("/a");
    dag.configureNode("/a", { handler });

    // /a/b 不存在
    expect(() =>
      dag.dispatch({ to: "/a/b", signals: [{ type: "test" }] }),
    ).not.toThrow();
    // handler 在 /a 触发但找不到 b 边 → 终止
    expect(handler).toHaveBeenCalled();
  });

  test("dispatch 应沿 defaultRoute 继续当 handler 无输出时", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a/default-leaf");
    dag.configureNode("/a", { defaultRoute: "default-leaf" });

    const leafCalls = [];
    dag.configureNode("/a/default-leaf", {
      handler(pkt, ctx) {
        leafCalls.push(ctx.path);
      },
    });

    dag.dispatch({ to: "/a", signals: [{ type: "go" }] });

    expect(leafCalls).toEqual(["/a/default-leaf"]);
  });

  test("dispatch depth 超限应抛错", () => {
    const dag = new DevicesDAG({ maxDispatchDepth: 2 });
    // 构造一条深度路径
    dag.ensureNode("/a/b/c/d");

    expect(() =>
      dag.dispatch({ to: "/a/b/c/d", signals: [{ type: "deep" }] }),
    ).toThrow(/depth exceeded/i);
  });

  // -----------------------------------------------------------------------
  // 累积上下文
  // -----------------------------------------------------------------------

  test("dispatch 应沿路径累积上下文且不可覆盖已有键", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a/b");
    dag.configureNode("/a", {
      handler(_pkt, _ctx) {
        return { context: { layer: "a" } };
      },
    });
    dag.configureNode("/a/b", {
      handler(_pkt, _ctx) {
        return { context: { layer: "b" } };
      },
    });

    // layer 在 a 层已注入，b 层再注入同名应该抛错
    expect(() =>
      dag.dispatch({ to: "/a/b", signals: [{ type: "test" }] }),
    ).toThrow(/already exists/i);
  });

  test("dispatch 应让下游 handler 读取上游注入的累积上下文", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a/b");
    dag.configureNode("/a", {
      handler(_pkt, _ctx) {
        return { context: { injected: 42 } };
      },
    });
    const bContext = [];
    dag.configureNode("/a/b", {
      handler(_pkt, ctx) {
        bContext.push(ctx.context);
      },
    });

    dag.dispatch({ to: "/a/b", signals: [{ type: "test" }] });

    expect(bContext[0].injected).toBe(42);
  });

  // -----------------------------------------------------------------------
  // Handler 可返回 stop / redirect / packets
  // -----------------------------------------------------------------------

  test("handler 返回 stop 应终止分发", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a/b");
    dag.configureNode("/a", {
      handler() {
        return { stop: true };
      },
    });
    const bHandler = jest.fn();
    dag.configureNode("/a/b", { handler: bHandler });

    dag.dispatch({ to: "/a/b", signals: [{ type: "test" }] });
    expect(bHandler).not.toHaveBeenCalled();
  });

  test("handler 返回 redirect 应覆盖下一段路由", () => {
    const dag = new DevicesDAG();
    dag.ensureNode("/a/x");
    dag.ensureNode("/a/y");
    dag.configureNode("/a", {
      handler() {
        return { redirect: "y" };
      },
    });
    const xHandler = jest.fn();
    const yHandler = jest.fn();
    dag.configureNode("/a/x", { handler: xHandler });
    dag.configureNode("/a/y", { handler: yHandler });

    dag.dispatch({ to: "/a/x", signals: [{ type: "test" }] });
    expect(xHandler).not.toHaveBeenCalled();
    expect(yHandler).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // DAG：多入边节点的分发行为
  // -----------------------------------------------------------------------

  test("dispatch 沿一条路径到达多入边节点时上下文只沿该路径累积", () => {
    const dag = new DevicesDAG();
    // 构建两条路径到达同一个叶子节点
    // 路径 A: root --route-a--> interA --leaf--> shared-leaf
    // 路径 B: root --route-b--> interB --leaf--> shared-leaf
    dag.ensureNode("/route-a");
    dag.ensureNode("/route-b");
    const leaf = dag.ensureNode("/shared-leaf");
    dag.addEdge("/route-a", "leaf", "/shared-leaf");
    dag.addEdge("/route-b", "leaf", "/shared-leaf");

    dag.configureNode("/route-a", {
      handler(_pkt, _ctx) {
        return { context: { via: "route-a" } };
      },
    });
    dag.configureNode("/route-b", {
      handler(_pkt, _ctx) {
        return { context: { via: "route-b" } };
      },
    });

    const leafContexts = [];
    dag.configureNode("/shared-leaf", {
      handler(_pkt, ctx) {
        leafContexts.push(ctx.context);
      },
    });

    // 走 route-a
    dag.dispatch({ to: "/route-a/leaf", signals: [{ type: "t" }] });
    // 走 route-b
    dag.dispatch({ to: "/route-b/leaf", signals: [{ type: "t" }] });

    expect(leafContexts[0].via).toBe("route-a");
    expect(leafContexts[1].via).toBe("route-b");
  });

  // -----------------------------------------------------------------------
  // Tool 挂载
  // -----------------------------------------------------------------------

  test("mountTool 应将 Tool 挂载到指定路径节点", () => {
    const dag = new DevicesDAG();
    const mockTool = {
      createProcessor() {
        const fn = (pkt, ctx) => {
          fn.lastPath = ctx.path;
        };
        fn.dispose = jest.fn();
        return fn;
      },
      createDeviceContext(hc) {
        return hc;
      },
      umount: jest.fn(),
    };

    dag.mountTool("/mouse/tool", mockTool);
    const node = dag.getNode("/mouse/tool");
    expect(node.handler).toBeInstanceOf(Function);
    expect(node.semantics.tool).toBe(true);

    dag.dispatch({ to: "/mouse/tool", signals: [{ type: "click" }] });
    expect(node.handler.lastPath).toBe("/mouse/tool");
  });

  // -----------------------------------------------------------------------
  // 卸载
  // -----------------------------------------------------------------------

  test("unmount 应执行卸载钩子并清理子图", () => {
    const dag = new DevicesDAG();
    const umountCalls = [];
    dag.ensureNode("/a/b");
    dag.configureNode("/a/b", {
      umount(ctx) {
        umountCalls.push(ctx.path);
      },
    });

    dag.unmount("/a");

    expect(dag.getNode("/a")).toBeUndefined();
    expect(umountCalls).toEqual(["/a/b"]);
  });

  test("unmount 不能卸载根节点", () => {
    const dag = new DevicesDAG();
    dag.unmount("/");
    expect(dag.getNode("/")).toBeInstanceOf(DevicesDAGNode);
  });
});

// =========================================================================
// Builder DSL（createSubDAG，方案 B）
// =========================================================================

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
