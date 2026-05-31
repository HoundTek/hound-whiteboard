import { DevicesTree, createSubTree } from "../devices-tree.js";
import { Tool } from "../../tools/tool.js";
import { CollectingTool } from "../../test-support/mock-tools.js";

describe("DevicesTree", () => {
  test("应能按路径挂载并查询节点", () => {
    const tree = new DevicesTree();
    const marker = () => ({ packets: [] });

    const node = tree.mount("/monitor/stylus", marker);

    expect(node.path).toBe("/monitor/stylus");
    expect(tree.getNode("/monitor/stylus")?.handler).toBe(marker);
    expect(tree.getNode("/monitor")?.path).toBe("/monitor");
  });

  test("节点自身应能处理信号并决定继续路由到哪个子节点", () => {
    const tree = new DevicesTree();
    const trace = [];

    tree.mount("/monitor/s-pen", (packet, context) => {
      const isButtonPressed = packet.signals.some(
        (signal) => signal.type === "button" && signal.context?.value === true,
      );
      trace.push(["root", context.path, isButtonPressed]);
      return {
        packets: [
          { to: isButtonPressed ? "eraser" : "pen", signals: packet.signals },
        ],
      };
    });

    tree.mount("/monitor/s-pen/pen", (packet, context) => {
      trace.push(["pen", context.path, packet.signals[0].type]);
      return {
        packets: [
          {
            to: "",
            signals: [{ type: "draw", context: { from: context.path } }],
          },
        ],
      };
    });

    tree.mount("/monitor/s-pen/eraser", (packet, context) => {
      trace.push(["eraser", context.path, packet.signals[0].type]);
      return {
        packets: [
          {
            to: "",
            signals: [{ type: "erase", context: { from: context.path } }],
          },
        ],
      };
    });

    const result = tree.dispatch({
      to: "/monitor/s-pen",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      { type: "draw", context: { from: "/monitor/s-pen/pen" } },
    ]);
  });

  test("父节点写入的状态应能被后续子节点显式读取", () => {
    const tree = new DevicesTree();
    let childState;

    tree.mount(
      "/monitor/pen",
      (packet, context) => {
        context.setNodeState("/monitor/pen", { object: { id: 42 } });
        return { packets: [{ to: "tool", signals: packet.signals }] };
      },
      { defaultChild: "tool" },
    );
    tree.mount("/monitor/pen/tool", (packet, context) => {
      childState = context.getNodeState("/monitor/pen");
      return { packets: [] };
    });

    tree.dispatch({
      to: "/monitor/pen",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(childState).toEqual({ object: { id: 42 } });
  });

  test("mountSubTree 应按结构化子树定义挂载整棵子树", () => {
    const tree = new DevicesTree();
    const subTreeDefinition = createSubTree("/s-pen")
      .node("")
      .handler((packet) => ({
        packets: [{ to: "pen", signals: packet.signals }],
      }))
      .end()
      .node("pen")
      .handler((packet, context) => ({
        packets: [
          { to: "", signals: [{ type: "draw", context: { from: "pen" } }] },
        ],
      }))
      .end()
      .node("eraser")
      .handler((packet, context) => ({
        packets: [
          { to: "", signals: [{ type: "erase", context: { from: "eraser" } }] },
        ],
      }))
      .end()
      .build();

    const mountedNodes = tree.mountSubTree("/monitor", subTreeDefinition);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/monitor/s-pen",
      "/monitor/s-pen/pen",
      "/monitor/s-pen/eraser",
    ]);
    expect(typeof tree.getNode("/monitor/s-pen/pen")?.handler).toBe("function");

    const result = tree.dispatch({
      to: "/monitor/s-pen",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      { type: "draw", context: { from: "pen" } },
    ]);
  });

  test("默认子链路应将输入继续送往存在的子节点", () => {
    const tree = new DevicesTree();

    tree.mount("/monitor/s-pen", null, { defaultChild: "pen" });
    tree.mount("/monitor/s-pen/pen", null, { defaultChild: "tool" });
    tree.mount("/monitor/s-pen/pen/tool", (packet, context) => ({
      packets: [
        {
          to: "",
          signals: [{ type: "draw", context: { from: context.path } }],
        },
      ],
    }));

    const result = tree.dispatch({
      to: "/monitor/s-pen",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      { type: "draw", context: { from: "/monitor/s-pen/pen/tool" } },
    ]);
  });

  test("configureNode 应支持动态替换 handler 与 defaultChild", () => {
    const tree = new DevicesTree();

    tree.mount("/monitor/keyboard/code/KeyW", null);
    tree.mount("/monitor/keyboard/code/KeyW/move/tool", (packet, context) => ({
      packets: [{ to: "", signals: packet.signals }],
    }));
    tree.mount(
      "/monitor/keyboard/code/KeyW/strafe/tool",
      (packet, context) => ({
        packets: [{ to: "", signals: packet.signals }],
      }),
    );

    // 动态替换 handler：路由到 move/tool
    tree.configureNode("/monitor/keyboard/code/KeyW", {
      handler(packet) {
        return {
          packets: [
            {
              to: "move/tool",
              signals: packet.signals.map((signal) => ({
                ...signal,
                context: { ...signal.context, axis: "y" },
              })),
            },
          ],
        };
      },
    });

    const result1 = tree.dispatch({
      to: "/monitor/keyboard/code/KeyW",
      signals: [{ type: "trigger", context: { code: "KeyW" } }],
    });

    expect(result1.packets).toHaveLength(1);
    expect(result1.packets[0].signals).toEqual([
      { type: "trigger", context: { code: "KeyW", axis: "y" } },
    ]);

    // 动态替换 handler：路由到 strafe/tool
    tree.configureNode("/monitor/keyboard/code/KeyW", {
      handler(packet) {
        return {
          packets: [
            {
              to: "strafe/tool",
              signals: packet.signals.map((signal) => ({
                ...signal,
                context: { ...signal.context, axis: "x" },
              })),
            },
          ],
        };
      },
      defaultChild: "fallback",
    });

    const result2 = tree.dispatch({
      to: "/monitor/keyboard/code/KeyW",
      signals: [{ type: "trigger", context: { code: "KeyW" } }],
    });

    expect(result2.packets).toHaveLength(1);
    expect(result2.packets[0].signals).toEqual([
      { type: "trigger", context: { code: "KeyW", axis: "x" } },
    ]);
    expect(tree.getNode("/monitor/keyboard/code/KeyW")?.defaultChild).toBe(
      "fallback",
    );
  });

  test("configureNode 应支持清空 handler 与 defaultChild", () => {
    const tree = new DevicesTree();

    tree.mount(
      "/monitor/keyboard/code/KeyW",
      (packet) => ({ packets: [{ to: "child", signals: packet.signals }] }),
      { defaultChild: "tool" },
    );

    tree.configureNode("/monitor/keyboard/code/KeyW", {
      handler: null,
      defaultChild: "",
    });

    const result = tree.dispatch({
      to: "/monitor/keyboard/code/KeyW",
      signals: [{ type: "trigger", context: { code: "KeyW" } }],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      { type: "trigger", context: { code: "KeyW" } },
    ]);
  });

  test("unmountLeaf 应沿 defaultChild 链卸载叶子节点", () => {
    const tree = new DevicesTree();

    tree.mount("/monitor/s-pen", null, { defaultChild: "pen" });
    tree.mount("/monitor/s-pen/pen", null, { defaultChild: "tool" });
    tree.mount("/monitor/s-pen/pen/tool", () => ({ packets: [] }));

    expect(tree.unmountLeaf("/monitor/s-pen")).toBe(true);
    expect(tree.getNode("/monitor/s-pen/pen/tool")).toBeNull();
    expect(tree.getNode("/monitor/s-pen/pen")).not.toBeNull();
  });

  test("mountTool 与 unmountTool 应使用显式工具节点路径", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, deviceContext) {
        this.calls.push({ signalPacket, deviceContext });
      }

      reset() {
        this.calls = [];
      }
    }

    const tree = new DevicesTree();
    const tool = new TestTool();

    tree.mount("/monitor/s-pen/pen", null, { defaultChild: "tool" });
    const toolNode = tree.mountTool("/monitor/s-pen/pen/tool", tool, {
      board: "board-runtime",
    });

    expect(toolNode.path).toBe("/monitor/s-pen/pen/tool");
    expect(tree.getNode("/monitor/s-pen/pen/tool")).not.toBeNull();

    tree.dispatch(
      {
        to: "/monitor/s-pen/pen",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      },
      { board: "board-runtime" },
    );

    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0].deviceContext).toEqual(
      expect.objectContaining({
        board: "board-runtime",
        path: "/monitor/s-pen/pen/tool",
      }),
    );

    expect(tree.unmountTool("/monitor/s-pen/pen/tool")).toBe(true);
    expect(tree.unmountTool("/monitor/s-pen/pen/tool")).toBe(false);
  });

  test("dispatch 深度超限时应抛错", () => {
    const tree = new DevicesTree({ maxDispatchDepth: 2 });

    // 循环路由：/loop → child → child → child ...
    tree.mount("/loop", (packet) => ({
      packets: [{ to: "child", signals: packet.signals }],
    }));
    tree.mount("/loop/child", (packet) => ({
      packets: [{ to: "child", signals: packet.signals }],
    }));
    tree.mount("/loop/child/child", (packet) => ({
      packets: [{ to: "child", signals: packet.signals }],
    }));

    expect(() =>
      tree.dispatch({
        to: "/loop",
        signals: [{ type: "trigger", context: {} }],
      }),
    ).toThrow("DevicesTree dispatch depth exceeded limit");
  });

  test("createSubTree 应按结构化节点挂载输入子树", () => {
    const tree = new DevicesTree();
    const keyboardSubTree = createSubTree("/keyboard")
      .node("")
      .defaultChild("event")
      .end()
      .node("event")
      .handler((packet, context) => ({
        packets: [
          {
            to: "",
            signals: packet.signals.map((signal) => ({
              ...signal,
              context: {
                ...signal.context,
                routedBy: context.path,
              },
            })),
          },
        ],
      }))
      .end()
      .build();

    const mountedNodes = tree.mountSubTree("/main", keyboardSubTree);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/main/keyboard",
      "/main/keyboard/event",
    ]);
    const result = tree.dispatch({
      to: "/main/keyboard",
      signals: [{ type: "position", context: { value: { x: 2, y: 4 } } }],
    });
    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      {
        type: "position",
        context: {
          value: { x: 2, y: 4 },
          routedBy: "/main/keyboard/event",
        },
      },
    ]);
  });

  test("handler 上下文应提供累积 context 并通过 dispatch 入口传入", () => {
    const tree = new DevicesTree();
    let observedContext;

    tree.mount(
      "/main/device",
      (packet, context) => {
        context.setNodeState("/main/device", {
          packetCount: packet.signals.length,
        });
        return { packets: [{ to: "child", signals: packet.signals }] };
      },
      { defaultChild: "child" },
    );

    tree.mount("/main/device/child", (packet, context) => {
      observedContext = {
        path: context.path,
        accumulatedContext: { ...context.context },
        state: context.getNodeState("/main/device"),
      };
      return { packets: [{ to: "", signals: packet.signals }] };
    });

    const result = tree.dispatch(
      {
        to: "/main/device",
        signals: [{ type: "trigger", context: { code: "KeyW" } }],
      },
      {
        board: "board-runtime",
        monitor: "monitor-runtime",
      },
    );

    expect(result.packets).toHaveLength(1);
    expect(observedContext.path).toBe("/main/device/child");
    expect(observedContext.accumulatedContext).toEqual({
      board: "board-runtime",
      monitor: "monitor-runtime",
    });
    expect(observedContext.state).toEqual({ packetCount: 1 });
  });

  test("mountTool 应使用显式工具节点路径", () => {
    const tree = new DevicesTree();
    const tool = new CollectingTool();

    tree.mount("/main/mouse", (packet) => ({
      packets: [{ to: "primary", signals: packet.signals }],
    }));
    tree.mount("/main/mouse/primary", null, { defaultChild: "tool" });
    tree.mountTool("/main/mouse/primary/tool", tool, {
      board: "board-runtime",
      monitor: "monitor-runtime",
    });

    tree.dispatch(
      {
        to: "/main/mouse",
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      },
      {
        board: "board-runtime",
        monitor: "monitor-runtime",
      },
    );

    expect(tree.getNode("/main/mouse/primary/tool")).not.toBeNull();
    expect(tree.getNode("/main/mouse/primary/tool/tool")).toBeNull();
    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0]).toEqual({
      signalPacket: expect.objectContaining({
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      }),
      deviceContext: expect.objectContaining({
        board: "board-runtime",
        monitor: "monitor-runtime",
        path: "/main/mouse/primary/tool",
      }),
    });
  });
});
