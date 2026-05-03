import { DevicesTree } from "../devices-tree.js";

describe("DevicesTree", () => {
  test("应能按路径挂载并查询节点", () => {
    const tree = new DevicesTree();
    const marker = { name: "pen" };

    const node = tree.mount("/monitor/stylus", marker);

    expect(node.path).toBe("/monitor/stylus");
    expect(tree.getNode("/monitor/stylus")?.device).toBe(marker);
    expect(tree.getNode("/monitor")?.path).toBe("/monitor");
  });

  test("dispatch 应将信号包路由到目标节点并支持再次转发", () => {
    const tree = new DevicesTree();
    const trace = [];

    tree.mount("/monitor/input", {
      processSignalPacket(packet, context) {
        trace.push(["input", context.path, packet.signals[0].type]);
        return [{
          to: "/monitor/board",
          signals: [{ type: "processed", context: { from: context.path } }],
        }];
      },
    });

    tree.mount("/monitor/board", {
      processSignalPacket(packet, context) {
        trace.push(["board", context.path, packet.signals[0].type]);
        return [{
          to: context.path,
          signals: [{ type: "committed", context: packet.signals[0].context }],
        }];
      },
    });

    const packets = tree.dispatch({
      to: "/monitor/input",
      signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
    });

    expect(trace).toEqual([
      ["input", "/monitor/input", "position"],
      ["board", "/monitor/board", "processed"],
    ]);
    expect(packets).toEqual([
      {
        to: "/monitor/board",
        signals: [{ type: "committed", context: { from: "/monitor/input" } }],
      },
    ]);
  });

  test("unmount 应移除整个子节点", () => {
    const tree = new DevicesTree();

    tree.mount("/monitor/stylus/tip", { name: "tip" });
    expect(tree.getNode("/monitor/stylus/tip")).not.toBeNull();

    expect(tree.unmount("/monitor/stylus")).toBe(true);
    expect(tree.getNode("/monitor/stylus")).toBeNull();
    expect(tree.getNode("/monitor/stylus/tip")).toBeNull();
  });
});