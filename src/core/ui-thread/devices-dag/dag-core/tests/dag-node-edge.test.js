import { DevicesDAGNode, DevicesDAGEdge } from "../../index.js";

describe("DevicesDAGNode", () => {
  describe("构造与初始状态", () => {
    test("构造后应具有默认值", () => {
      const node = new DevicesDAGNode(42);
      expect(node.id).toBe(42);
      expect(node.handler).toBeNull();
      expect(node.semantics).toEqual({});
      expect(node.state).toEqual({});
      expect(node.umount).toBeNull();
      expect(node.defaultRoute).toBe("");
      expect(node.outEdges).toBeInstanceOf(Map);
      expect(node.inEdges).toBeInstanceOf(Set);
      expect(node.path).toBeNull();
    });
  });

  describe("setHandler / getHandler", () => {
    test("setHandler 应设置处理器并返回 this", () => {
      const node = new DevicesDAGNode(1);
      const fn = () => "ok";
      const result = node.setHandler(fn);
      expect(result).toBe(node);
      expect(node.getHandler()).toBe(fn);
    });

    test("setHandler(null) 应将 handler 设为 null", () => {
      const node = new DevicesDAGNode(1);
      node.setHandler(() => { });
      node.setHandler(null);
      expect(node.handler).toBeNull();
      expect(node.getHandler()).toBeNull();
    });

    test("setHandler(非函数) 应将 handler 设为 null", () => {
      const node = new DevicesDAGNode(1);
      node.setHandler("not-a-function");
      expect(node.handler).toBeNull();
      expect(node.getHandler()).toBeNull();
    });

    test("getHandler 在 handler 为 null 时应返回 null", () => {
      const node = new DevicesDAGNode(1);
      expect(node.getHandler()).toBeNull();
    });
  });

  describe("setSemantics / getSemantics", () => {
    test("setSemantics 应设置语义并返回 this", () => {
      const node = new DevicesDAGNode(1);
      const result = node.setSemantics({ tool: true, prefix: false });
      expect(result).toBe(node);
      expect(node.getSemantics()).toEqual({ tool: true, prefix: false });
    });

    test("setSemantics(null) 应清空语义", () => {
      const node = new DevicesDAGNode(1);
      node.setSemantics({ tool: true });
      node.setSemantics(null);
      expect(node.getSemantics()).toEqual({});
    });

    test("setSemantics(非对象) 应清空语义", () => {
      const node = new DevicesDAGNode(1);
      node.setSemantics({ tool: true });
      node.setSemantics("not-object");
      expect(node.getSemantics()).toEqual({});
    });

    test("setSemantics 无参应清空语义", () => {
      const node = new DevicesDAGNode(1);
      node.setSemantics({ tool: true });
      node.setSemantics();
      expect(node.getSemantics()).toEqual({});
    });

    test("getSemantics 应返回副本而非引用", () => {
      const node = new DevicesDAGNode(1);
      node.setSemantics({ tool: true });
      const snap = node.getSemantics();
      snap.tool = false;
      expect(node.getSemantics().tool).toBe(true);
    });

    test("getSemantics 在语义为非纯对象时应返回空对象", () => {
      const node = new DevicesDAGNode(1);
      node.semantics = "broken";
      expect(node.getSemantics()).toEqual({});
    });
  });

  describe("setDefaultRoute / getDefaultRoute", () => {
    test("setDefaultRoute 应设置默认出边并返回 this", () => {
      const node = new DevicesDAGNode(1);
      const result = node.setDefaultRoute("next");
      expect(result).toBe(node);
      expect(node.getDefaultRoute()).toBe("next");
    });

    test("setDefaultRoute() 无参应设为空字符串", () => {
      const node = new DevicesDAGNode(1);
      node.setDefaultRoute("before");
      node.setDefaultRoute();
      expect(node.getDefaultRoute()).toBe("");
    });

    test("setDefaultRoute(非字符串) 应设为空字符串", () => {
      const node = new DevicesDAGNode(1);
      node.setDefaultRoute(123);
      expect(node.getDefaultRoute()).toBe("");
    });

    test("getDefaultRoute 在为空字符串时应返回空字符串", () => {
      const node = new DevicesDAGNode(1);
      expect(node.getDefaultRoute()).toBe("");
    });
  });

  describe("setUmountHandler / getUmountHandler", () => {
    test("setUmountHandler 应设置卸载钩子并返回 this", () => {
      const node = new DevicesDAGNode(1);
      const fn = () => "cleanup";
      const result = node.setUmountHandler(fn);
      expect(result).toBe(node);
      expect(node.getUmountHandler()).toBe(fn);
    });

    test("setUmountHandler(null) 应将 umount 设为 null", () => {
      const node = new DevicesDAGNode(1);
      node.setUmountHandler(() => { });
      node.setUmountHandler(null);
      expect(node.umount).toBeNull();
      expect(node.getUmountHandler()).toBeNull();
    });

    test("setUmountHandler(非函数) 应将 umount 设为 null", () => {
      const node = new DevicesDAGNode(1);
      node.setUmountHandler("not-a-function");
      expect(node.umount).toBeNull();
      expect(node.getUmountHandler()).toBeNull();
    });

    test("getUmountHandler 在 umount 为 null 时应返回 null", () => {
      const node = new DevicesDAGNode(1);
      expect(node.getUmountHandler()).toBeNull();
    });
  });
});

describe("DevicesDAGEdge", () => {
  test("构造后应正确设置 name、source、target", () => {
    const src = new DevicesDAGNode(1);
    const tgt = new DevicesDAGNode(2);
    const edge = new DevicesDAGEdge("my-edge", src, tgt);

    expect(edge.name).toBe("my-edge");
    expect(edge.source).toBe(src);
    expect(edge.target).toBe(tgt);
  });

  test("创建后源节点的 outEdges 不受影响（由 DAG 管理）", () => {
    const src = new DevicesDAGNode(1);
    const tgt = new DevicesDAGNode(2);
    new DevicesDAGEdge("e", src, tgt);

    // 直接 new Edge 不会修改节点
    expect(src.outEdges.size).toBe(0);
    expect(tgt.inEdges.size).toBe(0);
  });

  test("边名可以为空字符串", () => {
    const src = new DevicesDAGNode(1);
    const tgt = new DevicesDAGNode(2);
    const edge = new DevicesDAGEdge("", src, tgt);
    expect(edge.name).toBe("");
  });
});
