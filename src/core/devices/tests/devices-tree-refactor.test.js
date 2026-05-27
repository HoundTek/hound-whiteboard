import { DevicesTree, DevicesTreeNode, createSubTree } from "../devices-tree.js";
import { CollectingTool } from "../../test-support/mock-tools.js";

describe("DevicesTree refactor", () => {
  test("createSubTree 应按结构化节点挂载输入子树", () => {
    const tree = new DevicesTree();
    const keyboardSubTree = createSubTree("/keyboard")
      .node("")
      .defaultChild("event")
      .end()
      .node("event")
      .handler((packet, context) => ({
        to: context.eventContext.path,
        signals: packet.signals.map((signal) => ({
          ...signal,
          context: {
            ...signal.context,
            routedBy: context.eventContext.path,
          },
        })),
      }))
      .end()
      .build();

    const mountedNodes = tree.mountSubTree("/main", keyboardSubTree);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/main/keyboard",
      "/main/keyboard/event",
    ]);
    expect(
      tree.dispatch({
        to: "/main/keyboard",
        signals: [{ type: "position", context: { value: { x: 2, y: 4 } } }],
      }),
    ).toEqual([
      {
        to: "/main/keyboard/event",
        signals: [
          {
            type: "position",
            context: {
              value: { x: 2, y: 4 },
              routedBy: "/main/keyboard/event",
            },
          },
        ],
      },
    ]);
  });

  test("handler 上下文应区分 eventContext 与 runtimeContext 并支持节点状态", () => {
    const tree = new DevicesTree({
      runtimeContext: { board: "board-runtime" },
    });
    let observedContext;

    tree.mount(
      "/main/device",
      (packet, context) => {
        context.setNodeState("/main/device", {
          packetCount: packet.signals.length,
        });
        return { to: "child", signals: packet.signals };
      },
      { defaultChild: "child" },
    );

    tree.mount("/main/device/child", (packet, context) => {
      observedContext = {
        eventContext: context.eventContext,
        runtimeContext: context.runtimeContext,
        state: context.getNodeState("/main/device"),
      };
      return { to: context.eventContext.path, signals: packet.signals };
    });

    const packets = tree.dispatch(
      {
        to: "/main/device",
        signals: [{ type: "trigger", context: { code: "KeyW" } }],
      },
      {
        runtimeContext: { monitor: "monitor-runtime" },
      },
    );

    expect(packets).toEqual([
      {
        to: "/main/device/child",
        signals: [{ type: "trigger", context: { code: "KeyW" } }],
      },
    ]);
    expect(Object.isFrozen(observedContext.eventContext)).toBe(true);
    expect(observedContext.eventContext.path).toBe("/main/device/child");
    expect(observedContext.runtimeContext).toEqual({
      board: "board-runtime",
      monitor: "monitor-runtime",
    });
    expect(observedContext.state).toEqual({ packetCount: 1 });
  });

  test("mountTool 应使用显式工具节点路径", () => {
    const tree = new DevicesTree();
    const tool = new CollectingTool();

    tree.mount("/main/mouse", (packet) => ({
      to: "primary",
      signals: packet.signals,
    }));
    tree.mount("/main/mouse/primary", null, { defaultChild: "tool" });
    tree.mountTool("/main/mouse/primary/tool", tool, {
      board: "board-runtime",
      monitor: "monitor-runtime",
    });

    tree.dispatch({
      to: "/main/mouse",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });

    expect(tree.getNode("/main/mouse/primary/tool")).not.toBeNull();
    expect(tree.getNode("/main/mouse/primary/tool/tool")).toBeNull();
    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0]).toEqual({
      signalPacket: {
        to: "/main/mouse/primary/tool",
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      },
      deviceContext: expect.objectContaining({
        board: "board-runtime",
        monitor: "monitor-runtime",
        path: "/main/mouse/primary/tool",
      }),
    });
  });
});
