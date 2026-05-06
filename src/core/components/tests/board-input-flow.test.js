import { Board } from "../board.js";
import { Monitor } from "../monitor.js";
import { Tool } from "../../tools/tool.js";

describe("Board input flow", () => {
  function createCanvas() {
    return {
      width: 0,
      height: 0,
      id: "",
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600 };
      },
    };
  }

  function createMonitor(board, monitorId = "monitor") {
    board.width = 800;
    board.height = 600;
    board.pageOrder = [1];
    const monitor = new Monitor(
      createCanvas(),
      board,
      { width: 800, height: 600 },
      monitorId,
    );
    board.monitors.set(monitorId, monitor);
    return monitor;
  }

  test("input 事件应经由 Board、Monitor 与 DevicesTree 落到工具节点", () => {
    class CollectingTool extends Tool {
      calls = [];

      process(signalPacket, deviceContext) {
        this.calls.push({ signalPacket, deviceContext });
      }

      reset() {
        this.calls = [];
      }
    }

    const board = new Board();
    const monitor = createMonitor(board, "main");
    const tool = new CollectingTool();

    monitor.mountDevice("/sample-device", {
      defineNodes() {
        return [
          {
            path: "",
            processor(packet, context) {
              return {
                to: `${context.path}/tool`.replace(/\/+/g, "/"),
                signals: packet.signals,
              };
            },
          },
          {
            path: "/tool",
            processor: tool.createProcessor({ board, monitor }),
          },
        ];
      },
    });

    const emitResults = board.signalsEventBus.emit("input", {
      to: "/main/sample-device",
      signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
    });

    expect(emitResults).toEqual([undefined]);
    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0]).toEqual({
      signalPacket: {
        to: "/main/sample-device/tool",
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      },
      deviceContext: expect.objectContaining({
        board,
        monitor,
        path: "/main/sample-device/tool",
      }),
    });
  });

  test("input 事件指向不存在的 monitor 时应被忽略", () => {
    const board = new Board();

    expect(() =>
      board.signalsEventBus.emit("input", {
        to: "/missing/sample-device",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      }),
    ).not.toThrow();
  });
});
