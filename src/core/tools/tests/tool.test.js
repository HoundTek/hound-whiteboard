import { Tool } from "../tool.js";
import { SignalPacket } from "../../devices/signal.js";

describe("Tool", () => {
  test("createProcessor 应把输入规整后交给工具消费", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, deviceContext) {
        this.calls.push({ signalPacket, deviceContext });
      }

      reset() {
        this.calls = [];
      }
    }

    const tool = new TestTool();
    const processor = tool.createProcessor({ board: "board-context" });

    const result = processor(
      { signals: [{ type: "pressure", context: { value: 0.5 } }] },
      { path: "/monitor/s-pen/pen" },
    );

    expect(result).toBeUndefined();
    expect(tool.calls).toEqual([
      {
        signalPacket: {
          to: "",
          signals: [{ type: "pressure", context: { value: 0.5 } }],
        },
        deviceContext: {
          board: "board-context",
          path: "/monitor/s-pen/pen",
        },
      },
    ]);
  });

  test("基类 process 仍为抽象方法", () => {
    const tool = new Tool();
    expect(() => tool.process({ to: "/", signals: [] }, {})).toThrow(
      "Method not implemented.",
    );
  });
});
