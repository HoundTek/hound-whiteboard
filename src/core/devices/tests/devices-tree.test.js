import { DevicesTree, createSubTree } from "../devices-tree.js";
import { Tool } from "../../tools/tool.js";

describe("DevicesTree", () => {
  test("应能按路径挂载并查询节点", () => {
    const tree = new DevicesTree();
    const marker = () => [];

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
      trace.push(["root", context.eventContext.path, isButtonPressed]);
      return {
        to: isButtonPressed ? "eraser" : "pen",
        signals: packet.signals,
      };
    });

    tree.mount("/monitor/s-pen/pen", (packet, context) => {
      trace.push(["pen", context.eventContext.path, packet.signals[0].type]);
      return {
        to: context.eventContext.path,
        signals: [
          { type: "draw", context: { from: context.eventContext.path } },
        ],
      };
    });

    tree.mount("/monitor/s-pen/eraser", (packet, context) => {
      trace.push(["eraser", context.eventContext.path, packet.signals[0].type]);
      return {
        to: context.eventContext.path,
        signals: [
          { type: "erase", context: { from: context.eventContext.path } },
        ],
      };
    });

    const packets = tree.dispatch({
      to: "/monitor/s-pen",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(packets).toEqual([
      {
        to: "/monitor/s-pen/pen",
        signals: [{ type: "draw", context: { from: "/monitor/s-pen/pen" } }],
      },
    ]);
    expect(trace).toEqual([
      ["root", "/monitor/s-pen", false],
      ["pen", "/monitor/s-pen/pen", "position"],
    ]);
  });

  test("父节点写入的状态应能被后续子节点显式读取", () => {
    const tree = new DevicesTree();
    let childState;

    tree.mount(
      "/monitor/pen",
      (packet, context) => {
        context.setNodeState("/monitor/pen", { object: { id: 42 } });
        return { to: "tool", signals: packet.signals };
      },
      { defaultChild: "tool" },
    );
    tree.mount("/monitor/pen/tool", (packet, context) => {
      childState = context.getNodeState("/monitor/pen");
      return [];
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
      .handler((packet) => ({ to: "pen", signals: packet.signals }))
      .end()
      .node("pen")
      .handler((packet, context) => ({
        to: context.eventContext.path,
        signals: [{ type: "draw", context: { from: "pen" } }],
      }))
      .end()
      .node("eraser")
      .handler((packet, context) => ({
        to: context.eventContext.path,
        signals: [{ type: "erase", context: { from: "eraser" } }],
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

    expect(
      tree.dispatch({
        to: "/monitor/s-pen",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      }),
    ).toEqual([
      {
        to: "/monitor/s-pen/pen",
        signals: [{ type: "draw", context: { from: "pen" } }],
      },
    ]);
  });

  test("默认子链路应将输入继续送往存在的子节点", () => {
    const tree = new DevicesTree();

    tree.mount("/monitor/s-pen", null, { defaultChild: "pen" });
    tree.mount("/monitor/s-pen/pen", null, { defaultChild: "tool" });
    tree.mount("/monitor/s-pen/pen/tool", (packet, context) => ({
      to: context.eventContext.path,
      signals: [
        {
          type: "draw",
          context: { from: context.eventContext.path },
        },
      ],
    }));

    expect(
      tree.dispatch({
        to: "/monitor/s-pen",
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      }),
    ).toEqual([
      {
        to: "/monitor/s-pen/pen/tool",
        signals: [
          {
            type: "draw",
            context: { from: "/monitor/s-pen/pen/tool" },
          },
        ],
      },
    ]);
  });

  test("configureNode 应支持动态替换 handler 与 defaultChild", () => {
    const tree = new DevicesTree();

    tree.mount("/monitor/keyboard/code/KeyW", null);
    tree.mount("/monitor/keyboard/tools/move/tool", (packet, context) => ({
      to: context.eventContext.path,
      signals: packet.signals,
    }));
    tree.mount("/monitor/keyboard/tools/strafe/tool", (packet, context) => ({
      to: context.eventContext.path,
      signals: packet.signals,
    }));

    tree.configureNode("/monitor/keyboard/code/KeyW", {
      handler(packet) {
        return {
          to: "../../tools/move/tool",
          signals: packet.signals.map((signal) => ({
            ...signal,
            context: { ...signal.context, axis: "y" },
          })),
        };
      },
    });

    expect(
      tree.dispatch({
        to: "/monitor/keyboard/code/KeyW",
        signals: [{ type: "trigger", context: { code: "KeyW" } }],
      }),
    ).toEqual([
      {
        to: "/monitor/keyboard/tools/move/tool",
        signals: [{ type: "trigger", context: { code: "KeyW", axis: "y" } }],
      },
    ]);

    tree.configureNode("/monitor/keyboard/code/KeyW", {
      handler(packet) {
        return {
          to: "../../tools/strafe/tool",
          signals: packet.signals.map((signal) => ({
            ...signal,
            context: { ...signal.context, axis: "x" },
          })),
        };
      },
      defaultChild: "fallback",
    });

    expect(
      tree.dispatch({
        to: "/monitor/keyboard/code/KeyW",
        signals: [{ type: "trigger", context: { code: "KeyW" } }],
      }),
    ).toEqual([
      {
        to: "/monitor/keyboard/tools/strafe/tool",
        signals: [{ type: "trigger", context: { code: "KeyW", axis: "x" } }],
      },
    ]);
    expect(tree.getNode("/monitor/keyboard/code/KeyW")?.defaultChild).toBe(
      "fallback",
    );
  });

  test("configureNode 应支持清空 handler 与 defaultChild", () => {
    const tree = new DevicesTree();

    tree.mount(
      "/monitor/keyboard/code/KeyW",
      (packet) => ({ to: "child", signals: packet.signals }),
      { defaultChild: "tool" },
    );

    tree.configureNode("/monitor/keyboard/code/KeyW", {
      handler: null,
      defaultChild: "",
    });

    expect(
      tree.dispatch({
        to: "/monitor/keyboard/code/KeyW",
        signals: [{ type: "trigger", context: { code: "KeyW" } }],
      }),
    ).toEqual([
      {
        to: "/monitor/keyboard/code/KeyW",
        signals: [{ type: "trigger", context: { code: "KeyW" } }],
      },
    ]);
  });

  test("unmountLeaf 应沿 defaultChild 链卸载叶子节点", () => {
    const tree = new DevicesTree();

    tree.mount("/monitor/s-pen", null, { defaultChild: "pen" });
    tree.mount("/monitor/s-pen/pen", null, { defaultChild: "tool" });
    tree.mount("/monitor/s-pen/pen/tool", () => []);

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

    tree.dispatch({
      to: "/monitor/s-pen/pen",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

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

    tree.mount("/loop", (packet) => ({ to: "child", signals: packet.signals }));
    tree.mount("/loop/child", (packet) => ({
      to: "..",
      signals: packet.signals,
    }));

    expect(() =>
      tree.dispatch({
        to: "/loop",
        signals: [{ type: "trigger", context: {} }],
      }),
    ).toThrow("DevicesTree dispatch depth exceeded limit");
  });
});
