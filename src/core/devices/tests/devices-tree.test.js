import { DevicesTree } from "../devices-tree.js";
import { SignalPacket } from "../signal.js";

describe("DevicesTree", () => {
  test("应能按路径挂载并查询节点", () => {
    const tree = new DevicesTree();
    const marker = () => [];

    const node = tree.mount("/monitor/stylus", marker);

    expect(node.path).toBe("/monitor/stylus");
    expect(tree.getNode("/monitor/stylus")?.processor).toBe(marker);
    expect(tree.getNode("/monitor")?.path).toBe("/monitor");
  });

  test("节点自身应能处理信号并决定继续路由到哪个子节点", () => {
    const tree = new DevicesTree();
    const trace = [];

    // 此处以一个简单的 S Pen 为例
    tree.mount("/monitor/s-pen", (packet, context) => {
      const isButtonPressed = packet.signals.some(
        (signal) => signal.type === "button" && signal.context?.value === true,
      );
      trace.push(["root", context.path, isButtonPressed]);
      return [
        {
          to: isButtonPressed ? "/monitor/s-pen/eraser" : "/monitor/s-pen/pen",
          signals: packet.signals,
        },
      ];
    });

    tree.mount("/monitor/s-pen/pen", (packet, context) => {
      trace.push(["pen", context.path, packet.signals[0].type]);
      return [
        {
          to: context.path,
          signals: [{ type: "draw", context: { from: context.path } }],
        },
      ];
    });

    tree.mount("/monitor/s-pen/eraser", (packet, context) => {
      trace.push(["eraser", context.path, packet.signals[0].type]);
      return [
        {
          to: context.path,
          signals: [{ type: "erase", context: { from: context.path } }],
        },
      ];
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

  test("mountDevice 应按设备定义挂载整棵子树", () => {
    const createNodeProcessor =
      (nodePath) =>
      (signalPacket, routeContext = {}) =>
        SignalPacket.normalizeResult(
          processNodePacket(
            nodePath,
            SignalPacket.from(signalPacket, { defaultTo: "/" }),
            routeContext,
          ),
          { defaultTo: "/" },
        );

    const processNodePacket = (nodePath, packet) => {
      if (nodePath === "") {
        const isButtonPressed = packet.signals.some(
          (signal) =>
            signal.type === "button" && signal.context?.value === true,
        );
        return {
          to: isButtonPressed ? "/monitor/s-pen/eraser" : "/monitor/s-pen/pen",
          signals: packet.signals,
        };
      }

      return {
        to: `/monitor/s-pen/${nodePath}`,
        signals: [
          {
            type: nodePath === "pen" ? "draw" : "erase",
            context: { from: nodePath },
          },
        ],
      };
    };

    const deviceDefinition = {
      defineNodes() {
        return [
          { path: "", processor: createNodeProcessor("") },
          { path: "/pen", processor: createNodeProcessor("pen") },
          { path: "/eraser", processor: createNodeProcessor("eraser") },
        ];
      },
    };

    const tree = new DevicesTree();

    const mountedNodes = tree.mountDevice("/monitor/s-pen", deviceDefinition);

    expect(mountedNodes.map((node) => node.path)).toEqual([
      "/monitor/s-pen",
      "/monitor/s-pen/pen",
      "/monitor/s-pen/eraser",
    ]);

    expect(typeof tree.getNode("/monitor/s-pen/pen")?.processor).toBe(
      "function",
    );

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

  test("节点只应持有 processor", () => {
    const tree = new DevicesTree();

    const processor = () => [
      { to: "/monitor/node", signals: [{ type: "node" }] },
    ];
    const node = tree.mount("/monitor/node", processor);

    const packets = tree.dispatch({
      to: "/monitor/node",
      signals: [{ type: "position", context: {} }],
    });

    expect(packets).toEqual([
      {
        to: "/monitor/node",
        signals: [{ type: "node" }],
      },
    ]);
    expect(Object.prototype.hasOwnProperty.call(node, "device")).toBe(false);
  });

  test("unmount 应移除整个子节点", () => {
    const tree = new DevicesTree();

    tree.mount("/monitor/stylus/tip", () => []);
    expect(tree.getNode("/monitor/stylus/tip")).not.toBeNull();

    expect(tree.unmount("/monitor/stylus")).toBe(true);
    expect(tree.getNode("/monitor/stylus")).toBeNull();
    expect(tree.getNode("/monitor/stylus/tip")).toBeNull();
  });
});
