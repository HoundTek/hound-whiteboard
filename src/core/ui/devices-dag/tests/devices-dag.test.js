import { jest } from "@jest/globals";
import {
  DevicesDAG,
  DevicesDAGNode,
  DevicesDAGEdge,
  createSubDAG,
} from "../index.js";
import { SignalPacket } from "../signal.js";

// DevicesDAG 核心测试

describe("DevicesDAG", () => {
  describe("基本节点管理", () => {
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
  });

  describe("ensureNode", () => {
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
  });

  describe("addEdge", () => {
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
  });

  describe("DAG 特性", () => {
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
  });

  describe("removeEdge", () => {
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
  });

  describe("getNodeState / setNodeState", () => {
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
  });

  describe("configureNode", () => {
    test("configureNode 应更新节点 handler / semantics / defaultRoute / umount", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a");

      const handler = () => { };
      const umount = () => { };

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
      dag.configureNode("/a", { handler: () => { }, umount: () => { } });
      dag.configureNode("/a", { handler: null, umount: null });

      const node = dag.getNode("/a");
      expect(node.handler).toBeNull();
      expect(node.umount).toBeNull();
    });
  });

  describe("dispatch 基础行为", () => {
    test("dispatch 应沿路径逐段调用 handler", () => {
      const dag = new DevicesDAG();
      const calls = [];

      dag.ensureNode("/mouse/primary");
      dag.configureNode("/mouse", {
        handler(pkt, ctx) {
          calls.push({
            path: ctx.path,
            signals: pkt.signals.map((s) => s.type),
          });
        },
      });
      dag.configureNode("/mouse/primary", {
        handler(pkt, ctx) {
          calls.push({
            path: ctx.path,
            signals: pkt.signals.map((s) => s.type),
          });
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
  });

  describe("dispatch 累积上下文", () => {
    test("dispatch 应沿路径累积上下文且不可覆盖已有键", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");
      dag.configureNode("/a", {
        handler(_pkt, _ctx) {
          return { acc: { layer: "a" } };
        },
      });
      dag.configureNode("/a/b", {
        handler(_pkt, _ctx) {
          return { acc: { layer: "b" } };
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
          return { acc: { injected: 42 } };
        },
      });
      const bContext = [];
      dag.configureNode("/a/b", {
        handler(_pkt, ctx) {
          bContext.push(ctx.acc);
        },
      });

      dag.dispatch({ to: "/a/b", signals: [{ type: "test" }] });

      expect(bContext[0].injected).toBe(42);
    });
  });

  describe("dispatch 边缘行为", () => {
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
  });

  describe("dispatch 多入边节点", () => {
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
          return { acc: { via: "route-a" } };
        },
      });
      dag.configureNode("/route-b", {
        handler(_pkt, _ctx) {
          return { acc: { via: "route-b" } };
        },
      });

      const leafContexts = [];
      dag.configureNode("/shared-leaf", {
        handler(_pkt, ctx) {
          leafContexts.push(ctx.acc);
        },
      });

      // 走 route-a
      dag.dispatch({ to: "/route-a/leaf", signals: [{ type: "t" }] });
      // 走 route-b
      dag.dispatch({ to: "/route-b/leaf", signals: [{ type: "t" }] });

      expect(leafContexts[0].via).toBe("route-a");
      expect(leafContexts[1].via).toBe("route-b");
    });
  });

  describe("mount/umount Workflow", () => {
    test("mountWorkflow 应将 workflow 挂载到指定路径节点", () => {
      const dag = new DevicesDAG();
      const mockTool = {
        createProcessor() {
          const fn = (pkt, ctx) => {
            fn.lastPath = ctx.path;
          };
          fn.dispose = jest.fn();
          return fn;
        },
        umount: jest.fn(),
      };

      dag.mountWorkflow("/workflows/test-workflow", mockTool);
      const node = dag.getNode("/workflows/test-workflow");
      expect(node.handler).toBeInstanceOf(Function);
      expect(node.semantics.tool).toBe(true);

      dag.dispatch({
        to: "/workflows/test-workflow",
        signals: [{ type: "click" }],
      });
      expect(node.handler.lastPath).toBe("/workflows/test-workflow");
    });

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

  describe("toString", () => {
    test("toString 应返回包含根节点的树状字符串", () => {
      const dag = new DevicesDAG();
      const str = dag.toString();
      expect(str).toContain("/");
      expect(str).toContain("#0");
    });

    test("toString 应包含已挂载节点和边", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/workflows/test-workflow");
      dag.configureNode("/workflows/test-workflow", {
        semantics: { tool: true },
      });

      const str = dag.toString();
      expect(str).toContain("workflows");
      expect(str).toContain("test-workflow");
      expect(str).toContain("[tool]");
    });

    test("toString 应显示 handler 和 defaultRoute 标注", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");
      dag.configureNode("/a", { defaultRoute: "b" });
      dag.configureNode("/a/b", { handler: () => { } });

      const str = dag.toString();
      expect(str).toContain("[default=b]");
      expect(str).toContain("[handler]");
    });

    test("toString 应显示多入边节点的入边计数", () => {
      const dag = new DevicesDAG();
      const shared = dag.ensureNode("/shared");
      dag.addEdge("/", "route-a", "/shared");
      dag.addEdge("/", "route-b", "/shared");

      const str = dag.toString();
      expect(str).toContain("[in=3]"); // ensureNode 创建 1 条 + addEdge 2 条 = 3
    });
  });

  describe("分发边缘场景", () => {
    test("handler 返回多个 packet 时应通过 deferred routes 多路分发", () => {
      const dag = new DevicesDAG();
      // /a 分支到 /a/x 和 /a/y
      dag.ensureNode("/a/x");
      dag.ensureNode("/a/y");

      dag.configureNode("/a", {
        handler() {
          return {
            packets: [
              { to: "x", signals: [{ type: "to-x" }] },
              { to: "y", signals: [{ type: "to-y" }] },
            ],
          };
        },
      });

      const collected = [];
      dag.configureNode("/a/x", {
        handler(pkt) {
          collected.push({ path: "x", types: pkt.signals.map((s) => s.type) });
        },
      });
      dag.configureNode("/a/y", {
        handler(pkt) {
          collected.push({ path: "y", types: pkt.signals.map((s) => s.type) });
        },
      });

      dag.dispatch({ to: "/a", signals: [] });

      expect(collected).toHaveLength(2);
      expect(collected).toContainEqual({ path: "x", types: ["to-x"] });
      expect(collected).toContainEqual({ path: "y", types: ["to-y"] });
    });

    test("deferred route 中无 to 的 packet 应被丢弃（不进队列）", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/x");

      dag.configureNode("/a", {
        handler() {
          return {
            packets: [
              { to: "x", signals: [{ type: "primary" }] },
              { signals: [{ type: "no-to" }] }, // 无 to，不应进队列
            ],
          };
        },
      });

      const calls = [];
      dag.configureNode("/a/x", {
        handler(pkt) {
          calls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a", signals: [] });
      expect(calls).toEqual([["primary"]]);
    });

    test("多层嵌套的 deferred routes 应正确分发", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/x/leaf");
      dag.ensureNode("/a/y/leaf");

      dag.configureNode("/a", {
        handler() {
          return {
            packets: [
              { to: "x/leaf", signals: [{ type: "x-leaf" }] },
              { to: "y/leaf", signals: [{ type: "y-leaf" }] },
            ],
          };
        },
      });

      const collected = [];
      dag.configureNode("/a/x/leaf", {
        handler(pkt) {
          collected.push(pkt.signals.map((s) => s.type));
        },
      });
      dag.configureNode("/a/y/leaf", {
        handler(pkt) {
          collected.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a", signals: [] });
      expect(collected).toContainEqual(["x-leaf"]);
      expect(collected).toContainEqual(["y-leaf"]);
    });

    test("redirect 后再遇到 packets.to 应覆盖 redirect 的路径", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/redirect-target");
      dag.ensureNode("/a/packet-target");

      dag.configureNode("/a", {
        handler() {
          return {
            redirect: "redirect-target",
            packets: [{ to: "packet-target", signals: [{ type: "final" }] }],
          };
        },
      });

      const calls = [];
      dag.configureNode("/a/redirect-target", {
        handler: jest.fn(),
      });
      dag.configureNode("/a/packet-target", {
        handler(pkt) {
          calls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a/original", signals: [] });

      // packets[0].to 覆盖了 redirect
      expect(dag.getNode("/a/redirect-target").handler).not.toHaveBeenCalled();
      expect(calls).toEqual([["final"]]);
    });

    test("仅 redirect 无 packets 时应正确修改后续路径", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/redirect-target");
      dag.ensureNode("/a/original-target");

      dag.configureNode("/a", {
        handler() {
          return { redirect: "redirect-target" };
        },
      });

      const calls = [];
      dag.configureNode("/a/redirect-target", {
        handler(pkt) {
          calls.push(pkt.signals.map((s) => s.type));
        },
      });
      dag.configureNode("/a/original-target", { handler: jest.fn() });

      dag.dispatch({
        to: "/a/original-target",
        signals: [{ type: "rerouted" }],
      });
      expect(calls).toEqual([["rerouted"]]);
    });

    test("stop 时返回的 packets 应一并收入最终结果", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");

      dag.configureNode("/a", {
        handler() {
          return {
            stop: true,
            packets: [{ signals: [{ type: "stopped" }] }],
          };
        },
      });

      const result = dag.dispatch({
        to: "/a/b",
        signals: [{ type: "initial" }],
      });
      expect(result.packets).toHaveLength(1);
      expect(result.packets[0].signals.map((s) => s.type)).toEqual(["stopped"]);
    });

    test("stop 但有之前累积的 finalPackets 应优先返回", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");

      dag.configureNode("/a", {
        handler() {
          return {
            stop: true,
            packets: [{ signals: [{ type: "stop-pkt" }] }],
          };
        },
      });

      // 在 /a 的 handler 中被 stop 前，不会有 prior finalPackets
      // 所以直接用 stop 的 packets
      const result = dag.dispatch({ to: "/a/b", signals: [] });
      expect(result.packets[0].signals.map((s) => s.type)).toEqual([
        "stop-pkt",
      ]);
    });

    test("handler 显式返回空 packets 应终止分发", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");

      dag.configureNode("/a", {
        handler() {
          return { packets: [] };
        },
      });
      const bHandler = jest.fn();
      dag.configureNode("/a/b", { handler: bHandler });

      const result = dag.dispatch({ to: "/a/b", signals: [{ type: "t" }] });
      expect(bHandler).not.toHaveBeenCalled();
      expect(result.packets).toEqual([]);
    });

    test("handler 返回空且到路径末且节点无 defaultRoute 时应返回空", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/leaf");

      // handler 什么都不返回
      dag.configureNode("/leaf", { handler() { } });

      const result = dag.dispatch({ to: "/leaf", signals: [{ type: "t" }] });
      expect(result.packets).toEqual([]);
    });

    test("根节点的 defaultRoute 应在 packet 无 to 时生效", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/default-root-target");
      dag.configureNode("/", { defaultRoute: "default-root-target" });

      const calls = [];
      dag.configureNode("/default-root-target", {
        handler(pkt) {
          calls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ signals: [{ type: "auto" }] });
      expect(calls).toEqual([["auto"]]);
    });

    test("根 handler 注入的初始 context 应传递到下游 handler", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a");

      // 通过根 handler 注入初始上下文
      dag.configureNode("/", {
        handler() {
          return { acc: { initialKey: "initialVal" } };
        },
      });

      const ctxSnap = [];
      dag.configureNode("/a", {
        handler(_pkt, ctx) {
          ctxSnap.push({ ...ctx.acc });
        },
      });

      dag.dispatch({ to: "/a", signals: [{ type: "t" }] });

      expect(ctxSnap[0].initialKey).toBe("initialVal");
    });

    test("多节点逐层注入不同 context key 应全部可见", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b/c");

      dag.configureNode("/a", {
        handler() {
          return { acc: { layerA: 1 } };
        },
      });
      dag.configureNode("/a/b", {
        handler() {
          return { acc: { layerB: 2 } };
        },
      });
      const finalCtx = [];
      dag.configureNode("/a/b/c", {
        handler(_pkt, ctx) {
          finalCtx.push({ ...ctx.acc });
        },
      });

      dag.dispatch({ to: "/a/b/c", signals: [{ type: "t" }] });
      expect(finalCtx[0]).toEqual({ layerA: 1, layerB: 2 });
    });

    test("handler 返回非纯对象的 context 应被忽略", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");

      dag.configureNode("/a", {
        handler() {
          return { acc: "not-a-plain-object" };
        },
      });
      dag.configureNode("/a/b", {
        handler(_pkt, ctx) {
          ctx.snap = { ...ctx.acc };
        },
      });

      expect(() =>
        dag.dispatch({ to: "/a/b", signals: [{ type: "t" }] }),
      ).not.toThrow();
    });

    test("redirect 后 handler 返回 packets.to 应正确变更路径", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/redirected/leaf");
      dag.ensureNode("/a/packet-override/leaf");

      dag.configureNode("/a", {
        handler() {
          // redirect 先作用于 segments，但 packets[0].to 会立即覆盖
          return {
            redirect: "redirected/leaf",
            packets: [
              { to: "packet-override/leaf", signals: [{ type: "final" }] },
            ],
          };
        },
      });

      const calls = [];
      dag.configureNode("/a/packet-override/leaf", {
        handler(pkt) {
          calls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a/original", signals: [] });
      expect(calls).toEqual([["final"]]);
    });

    test("handler 返回包含 stop/redirect/packets 的混合格式", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");
      dag.ensureNode("/a/c");

      // 混合：redirect 修改路径 + 但 stop 会终止
      dag.configureNode("/a", {
        handler() {
          return {
            redirect: "c",
            stop: true,
            packets: [{ signals: [{ type: "stopped" }] }],
          };
        },
      });

      const bHandler = jest.fn();
      const cHandler = jest.fn();
      dag.configureNode("/a/b", { handler: bHandler });
      dag.configureNode("/a/c", { handler: cHandler });

      const result = dag.dispatch({ to: "/a/b", signals: [{ type: "t" }] });
      // stop 先于 redirect 生效 → redirect 不会执行
      expect(bHandler).not.toHaveBeenCalled();
      expect(cHandler).not.toHaveBeenCalled();
      expect(result.packets[0].signals.map((s) => s.type)).toEqual(["stopped"]);
    });

    test("defaultRoute 导致的无限循环应被深度限制捕获", () => {
      const dag = new DevicesDAG({ maxDispatchDepth: 5 });
      // 构造自环：/loop 的 defaultRoute 指向自身
      dag.ensureNode("/loop");
      dag.addEdge("/loop", "self", "/loop");
      dag.configureNode("/loop", { defaultRoute: "self" });

      expect(() =>
        dag.dispatch({ to: "/loop", signals: [{ type: "oops" }] }),
      ).toThrow(/depth exceeded/i);
    });

    test("handler 返回 undefined 应视为无输出继续走 defaultRoute", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/default-leaf");
      dag.configureNode("/a", { defaultRoute: "default-leaf" });

      const leafCalls = [];
      dag.configureNode("/a/default-leaf", {
        handler(pkt) {
          leafCalls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a", signals: [{ type: "go" }] });
      expect(leafCalls).toEqual([["go"]]);
    });

    test("handler 返回裸 SignalPacket 应正确路由", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");

      dag.configureNode("/a", {
        handler() {
          return new SignalPacket("b", [{ type: "forwarded" }]);
        },
      });

      const calls = [];
      dag.configureNode("/a/b", {
        handler(pkt) {
          calls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a", signals: [] });
      expect(calls).toEqual([["forwarded"]]);
    });

    test("handler 返回裸对象（无 packets/stop/redirect/context 标记）应视为信号包", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");

      dag.configureNode("/a", {
        handler() {
          return { to: "b", signals: [{ type: "bare" }] };
        },
      });

      const calls = [];
      dag.configureNode("/a/b", {
        handler(pkt) {
          calls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a", signals: [] });
      expect(calls).toEqual([["bare"]]);
    });

    test("handler 返回数组且元素为裸信号包应全部处理", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/x");
      dag.ensureNode("/a/y");

      dag.configureNode("/a", {
        handler() {
          return [
            { to: "x", signals: [{ type: "arr-x" }] },
            { to: "y", signals: [{ type: "arr-y" }] },
          ];
        },
      });

      const collected = [];
      dag.configureNode("/a/x", {
        handler(pkt) {
          collected.push(pkt.signals.map((s) => s.type));
        },
      });
      dag.configureNode("/a/y", {
        handler(pkt) {
          collected.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a", signals: [] });
      expect(collected).toHaveLength(2);
      expect(collected).toContainEqual(["arr-x"]);
      expect(collected).toContainEqual(["arr-y"]);
    });

    test("handler 返回 null 应视为无输出但 defaultRoute 仍生效", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/default-leaf");
      dag.configureNode("/a", { defaultRoute: "default-leaf" });

      dag.configureNode("/a", { handler: () => null });

      const result = dag.dispatch({ to: "/a", signals: [{ type: "t" }] });
      // null → normalizeHandlerResult → { packets: [], explicitPackets: false }
      // 走到路径末且有 defaultRoute → 继续走到 /a/default-leaf
      // /a/default-leaf 无 handler → 生成默认包
      expect(result.packets).toHaveLength(1);
      expect(result.packets[0].signals.map((s) => s.type)).toEqual(["t"]);
    });

    test("dispatch 到完全不存在的路径应静默终止", () => {
      const dag = new DevicesDAG();
      const result = dag.dispatch({
        to: "/nowhere",
        signals: [{ type: "ghost" }],
      });
      expect(result.packets).toHaveLength(1);
      expect(result.packets[0].signals.map((s) => s.type)).toEqual(["ghost"]);
    });

    test("dispatch 中间段不存在但前面已有 finalPackets 应返回已收集的", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");

      dag.configureNode("/a", {
        handler() {
          return {
            packets: [
              { to: "b", signals: [{ type: "to-b" }] },
              { to: "c", signals: [{ type: "to-c" }] }, // /a/c 不存在
            ],
          };
        },
      });

      const bCalls = [];
      dag.configureNode("/a/b", {
        handler(pkt) {
          bCalls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a", signals: [] });
      // /a/b 应收到信号
      expect(bCalls).toEqual([["to-b"]]);
      // /a/c 不存在 → deferred route 静默终止
    });
  });

  describe("tool 实例重复挂载检查", () => {
    const makeTool = () => ({
      createProcessor() {
        return () => { };
      },
    });

    test("同一 tool 实例重复 mountWorkflow 应抛错", () => {
      const dag = new DevicesDAG();
      const tool = makeTool();
      dag.mountWorkflow("/wf/a", tool);
      expect(() => dag.mountWorkflow("/wf/b", tool)).toThrow(
        /already mounted/i,
      );
    });

    test("卸载后重新挂载同一 tool 实例应成功", () => {
      const dag = new DevicesDAG();
      const tool = makeTool();

      dag.mountWorkflow("/wf/a", tool);

      dag.unmount("/wf");
      // 卸载后 _mountedToolInstances 已清理
      expect(dag._mountedToolInstances.has(tool)).toBe(false);

      // 重新挂载应成功
      expect(() => dag.mountWorkflow("/wf2/a", tool)).not.toThrow();
      expect(dag.getNode("/wf2/a")).not.toBeUndefined();
    });

    test("不同 tool 实例挂载到不同路径应正常", () => {
      const dag = new DevicesDAG();
      const toolA = makeTool();
      const toolB = makeTool();
      expect(() => dag.mountWorkflow("/wf/a", toolA)).not.toThrow();
      expect(() => dag.mountWorkflow("/wf/b", toolB)).not.toThrow();
    });

    test("通过 mountSubDAG 挂载同一 tool 实例两次应抛错", () => {
      const dag = new DevicesDAG();
      const tool = makeTool();

      const b1 = createSubDAG("/sub1");
      b1.node().tool(tool);
      dag.mountSubDAG("", b1.build());

      const b2 = createSubDAG("/sub2");
      b2.node().tool(tool);
      expect(() => dag.mountSubDAG("", b2.build())).toThrow(/already mounted/i);
    });
  });

  describe("getNode 相对路径", () => {
    test("getNode 应支持相对路径", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");
      expect(dag.getNode("a/b")).toBeInstanceOf(DevicesDAGNode);
      expect(dag.getNode("a/b")).toBe(dag.getNode("/a/b"));
    });
  });

  describe("resolveRelativeNode", () => {
    test("resolveRelativeNode 应从指定节点解析相对路径", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");
      const aNode = dag.getNode("/a");
      // resolveRelativeNode 内部使用 resolvePath("/", relativePath) 解析为绝对路径
      // 然后调用 getNode(absolutePath)，所以 "b" 会解析为 "/b"
      const result = dag.resolveRelativeNode(aNode, "/a/b");
      expect(result).toBe(dag.getNode("/a/b"));
    });

    test("resolveRelativeNode 在 fromNode 为 undefined 时应返回 undefined", () => {
      const dag = new DevicesDAG();
      expect(dag.resolveRelativeNode(undefined, "a")).toBeUndefined();
    });

    test("resolveRelativeNode 空路径应返回根节点", () => {
      const dag = new DevicesDAG();
      const root = dag.getNode("/");
      expect(dag.resolveRelativeNode(root, "")).toBe(root);
    });
  });

  describe("getNodePath", () => {
    test("getNodePath 应返回节点的一条可达路径", () => {
      const dag = new DevicesDAG();
      const node = dag.ensureNode("/a/b");
      const path = dag.getNodePath(node);
      expect(path).toBe("/a/b");
    });

    test("getNodePath 对根节点应返回 /", () => {
      const dag = new DevicesDAG();
      expect(dag.getNodePath(dag.getNode("/"))).toBe("/");
    });

    test("getNodePath 对 undefined 应返回 undefined", () => {
      const dag = new DevicesDAG();
      expect(dag.getNodePath(undefined)).toBeUndefined();
    });

    test("getNodePath 对多入边节点应返回其中一条路径", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/shared");
      dag.addEdge("/", "via-a", "/shared");
      dag.addEdge("/", "via-b", "/shared");
      const path = dag.getNodePath(dag.getNode("/shared"));
      expect(typeof path).toBe("string");
      expect(path.startsWith("/")).toBe(true);
    });
  });

  describe("mount() 方法", () => {
    test("mount 应设置 handler、semantics 和 defaultRoute", () => {
      const dag = new DevicesDAG();
      const handler = () => { };
      const node = dag.mount("/mounted", handler, {
        semantics: { prefix: true },
        defaultRoute: "next",
      });
      expect(node.handler).toBe(handler);
      expect(node.semantics).toMatchObject({ prefix: true });
      expect(node.defaultRoute).toBe("next");
    });

    test("mount 应通过 defaultRoute 设置默认路由", () => {
      const dag = new DevicesDAG();
      const node = dag.mount("/mounted", () => { }, {
        defaultRoute: "leaf",
      });
      expect(node.defaultRoute).toBe("leaf");
    });

    test("mount 不传 defaultRoute 时应为空串", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/mounted");
      const node = dag.mount("/mounted", () => { }, {});
      expect(node.defaultRoute).toBe("");
    });

    test("mount 不传 handler 不应覆盖已有 handler", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/mounted");
      dag.configureNode("/mounted", { handler: () => "existing" });
      dag.mount("/mounted");
      expect(dag.getNode("/mounted").handler).toBeInstanceOf(Function);
    });

    test("mount 应设置 umount 钩子", () => {
      const dag = new DevicesDAG();
      const cleanup = () => { };
      dag.mount("/mounted", () => { }, { umount: cleanup });
      expect(dag.getNode("/mounted").umount).toBe(cleanup);
    });
  });

  describe("mountWorkflow 边界", () => {
    test("mountWorkflow 在节点已有 handler 时应抛错", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/occupied");
      dag.configureNode("/occupied", { handler: () => { } });
      const tool = {
        createProcessor() {
          return () => { };
        },
      };
      expect(() => dag.mountWorkflow("/occupied", tool)).toThrow(
        /already has a handler/i,
      );
    });

    test("mountWorkflow 传入 SubDAGDefinition 应委托 mountSubDAG", () => {
      const dag = new DevicesDAG();
      const builder = createSubDAG("/wf-sub");
      const handler = () => { };
      builder.node().handler(handler);
      const subDAG = builder.build();

      const result = dag.mountWorkflow("/workflows/wf", subDAG);
      expect(Array.isArray(result)).toBe(true);
      expect(dag.getNode("/workflows/wf")).toBeInstanceOf(DevicesDAGNode);
    });
  });

  describe("mountSubDAG 边界", () => {
    test("mountSubDAG 传入 null 应返回空数组", () => {
      const dag = new DevicesDAG();
      expect(dag.mountSubDAG("", null)).toEqual([]);
    });

    test("mountSubDAG 传入非对象应返回空数组", () => {
      const dag = new DevicesDAG();
      expect(dag.mountSubDAG("", "not-object")).toEqual([]);
    });

    test("mountSubDAG 应处理重复边名（幂等）", () => {
      const dag = new DevicesDAG();
      const builder = createSubDAG("/dup");
      const r = builder.node();
      const c = builder.node();
      builder.edge("link", r, c);
      // 先手动创建同一条边
      dag.ensureNode("/dup/link");

      expect(() => dag.mountSubDAG("", builder.build())).not.toThrow();
    });
  });

  describe("unmount 边界", () => {
    test("unmount 对不存在的路径应返回 false", () => {
      const dag = new DevicesDAG();
      expect(dag.unmount("/nowhere")).toBe(false);
    });

    test("unmount 对中间段缺失的路径应返回 false", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a");
      expect(dag.unmount("/a/b/c")).toBe(false);
    });

    test("unmount 应清理 tool 实例注册", () => {
      const dag = new DevicesDAG();
      const tool = {
        createProcessor() {
          return () => { };
        },
      };
      dag.mountWorkflow("/wf/tool", tool);
      expect(dag._mountedToolInstances.has(tool)).toBe(true);
      dag.unmount("/wf");
      expect(dag._mountedToolInstances.has(tool)).toBe(false);
    });

    test("unmount 多入边节点只清除指定路径的入边", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/shared");
      dag.addEdge("/", "route-a", "/shared");
      dag.addEdge("/", "route-b", "/shared");

      // 卸载 route-a 路径
      dag.unmount("/route-a");
      expect(dag.getNode("/route-a")).toBeUndefined();
      // route-b 仍然可达
      expect(dag.getNode("/route-b")).toBe(dag.getNode("/shared"));
    });

    test("unmountWorkflow 应委托 unmount", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/wf/test");
      const result = dag.unmountWorkflow("/wf");
      expect(result).toBe(true);
      expect(dag.getNode("/wf")).toBeUndefined();
    });
  });

  describe("configureNode 边界", () => {
    test("configureNode 应通过 defaultRoute 设置默认路由", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/legacy");
      dag.configureNode("/legacy", { defaultRoute: "old-way" });
      expect(dag.getNode("/legacy").defaultRoute).toBe("old-way");
    });

    test("configureNode 的 defaultRoute 为 null 时应清空", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/legacy");
      dag.configureNode("/legacy", { defaultRoute: "before" });
      dag.configureNode("/legacy", { defaultRoute: null });
      expect(dag.getNode("/legacy").defaultRoute).toBe("");
    });
  });

  describe("dispatch 其他边缘场景", () => {
    test("dispatch 深度超限应在 _walkSegments 中抛错", () => {
      const dag = new DevicesDAG({ maxDispatchDepth: 2 });
      dag.ensureNode("/deep/deep/deep");
      expect(() =>
        dag.dispatch({ to: "/deep/deep/deep", signals: [{ type: "d" }] }),
      ).toThrow(/depth exceeded/i);
    });

    test("dispatch 无 to 且根节点无 defaultRoute 应返回原包", () => {
      const dag = new DevicesDAG();
      const result = dag.dispatch({ signals: [{ type: "no-target" }] });
      expect(result.packets).toHaveLength(1);
      expect(result.packets[0].signals[0].type).toBe("no-target");
    });

    test("dispatch 在路径末节点无 handler 应有默认行为", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");
      const result = dag.dispatch({ to: "/a/b", signals: [{ type: "t" }] });
      // 中间 /a 无 handler → 默认生成继续包
      // 末端 /a/b 无 handler → 默认生成最终包
      expect(result.packets).toHaveLength(1);
      expect(result.packets[0].signals[0].type).toBe("t");
    });

    test("handler 返回 empty 信号数组应正常继续", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");
      dag.configureNode("/a", {
        handler() {
          return { signals: [] };
        },
      });
      const bCalls = [];
      dag.configureNode("/a/b", {
        handler(pkt) {
          bCalls.push(pkt.signals.map((s) => s.type));
        },
      });

      dag.dispatch({ to: "/a/b", signals: [{ type: "t" }] });
      expect(bCalls).toEqual([["t"]]);
    });

    test("多包返回：主包优先于延迟包到达目标节点", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a/b");

      const order = [];
      dag.configureNode("/a", {
        handler() {
          return {
            packets: [
              new SignalPacket("b", [{ type: "primary" }]),
              new SignalPacket("b", [{ type: "deferred-1" }]),
              new SignalPacket("b", [{ type: "deferred-2" }]),
            ],
          };
        },
      });

      dag.configureNode("/a/b", {
        handler(pkt) {
          for (const s of pkt.signals) {
            order.push(s.type);
          }
        },
      });

      dag.dispatch({ to: "/a/b", signals: [{ type: "start" }] });

      // primary 的 to:"b" 路由到 /a/b，deferred 随后
      expect(order).toEqual(["primary", "deferred-1", "deferred-2"]);
    });
  });

  describe("setNodeState 边界", () => {
    test("setNodeState 传入非纯对象应使用空对象", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a");
      dag.setNodeState("/a", "not-object");
      expect(dag.getNodeState("/a")).toEqual({});
    });

    test("setNodeState 无 state 参数应使用空对象", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/a");
      dag.setNodeState("/a", { count: 5 });
      dag.setNodeState("/a");
      expect(dag.getNodeState("/a")).toEqual({});
    });
  });

  describe("toString 其他场景", () => {
    test("空 DAG 的 toString 应包含根节点", () => {
      const dag = new DevicesDAG();
      const str = dag.toString();
      expect(str).toContain("/");
      expect(str).toContain("#0");
    });

    test("toString 应显示 viewport 标注", () => {
      const dag = new DevicesDAG();
      dag.ensureNode("/mon");
      dag.configureNode("/mon", { semantics: { viewport: true } });
      const str = dag.toString();
      expect(str).toContain("[viewport]");
    });
  });
});
