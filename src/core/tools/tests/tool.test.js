import { Tool } from "../tool.js";
import { SignalPacket } from "../../devices-dag/signal.js";

describe("Tool", () => {
  test("createProcessor 应把输入规整后交给工具消费", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, context) {
        this.calls.push({ signalPacket, context });
      }

      reset() {
        this.calls = [];
      }
    }

    const tool = new TestTool();
    const processor = tool.createProcessor();

    const result = processor(
      { signals: [{ type: "pressure", context: { value: 0.5 } }] },
      {
        path: "/monitor/s-pen/pen",
        context: {},
        acc: { board: "board-context" },
      },
    );

    expect(result).toBeUndefined();
    expect(tool.calls).toEqual([
      {
        signalPacket: {
          to: "",
          signals: [{ type: "pressure", context: { value: 0.5 } }],
        },
        context: expect.objectContaining({
          path: "/monitor/s-pen/pen",
          acc: expect.objectContaining({
            board: "board-context",
          }),
        }),
      },
    ]);
    expect(tool.calls[0].context.acc.allocateObjectId).toBeUndefined();
  });

  test("createProcessor 应默认暴露来自 Board 的 allocateObjectId", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, context) {
        this.calls.push({ signalPacket, context });
      }

      reset() {
        this.calls = [];
      }
    }

    const tool = new TestTool();
    const board = {
      allocateObjectId() {
        return 7;
      },
    };
    const processor = tool.createProcessor();

    processor(
      { signals: [{ type: "pressure", context: { value: 0.5 } }] },
      {
        path: "/monitor/s-pen/pen",
        context: {},
        acc: { board },
      },
    );

    expect(tool.calls[0].context.acc.allocateObjectId()).toBe(7);
  });

  test("createProcessor 应默认暴露来自 Monitor 的 resolveOwnerChunkId", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, context) {
        this.calls.push({ signalPacket, context });
      }

      reset() {
        this.calls = [];
      }
    }

    const tool = new TestTool();
    const monitor = {
      worldToChunk(position) {
        if (position.x === 10 && position.y === 20) {
          return { chunkId: 3, x: 10, y: 20 };
        }
        return null;
      },
    };
    const processor = tool.createProcessor();

    processor(
      { signals: [{ type: "position", context: { value: { x: 10, y: 20 } } }] },
      {
        path: "/monitor/s-pen/pen",
        context: {},
        acc: { monitor },
      },
    );

    expect(
      tool.calls[0].context.acc.resolveOwnerChunkId({
        x: 10,
        y: 20,
      }),
    ).toBe(3);
  });

  test("createProcessor 应优先使用累积 context 中的 board/monitor 并保留平面上下文", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, context) {
        this.calls.push({ signalPacket, context });
      }

      reset() {
        this.calls = [];
      }
    }

    const tool = new TestTool();
    const boardFromContext = {
      allocateObjectId() {
        return 11;
      },
    };
    const monitorFromContext = {
      worldToChunk() {
        return { chunkId: 9 };
      },
    };

    tool.createProcessor()(
      { signals: [{ type: "trigger", context: {} }] },
      {
        path: "/monitor/s-pen/pen",
        acc: {
          board: boardFromContext,
          monitor: monitorFromContext,
          customFlag: true,
        },
      },
    );

    expect(tool.calls[0].context).toEqual(
      expect.objectContaining({
        acc: expect.objectContaining({
          board: boardFromContext,
          monitor: monitorFromContext,
          customFlag: true,
        }),
      }),
    );
    expect(tool.calls[0].context.acc.allocateObjectId()).toBe(11);
    expect(tool.calls[0].context.acc.resolveOwnerChunkId({ x: 1, y: 2 })).toBe(
      9,
    );
    expect(tool.calls[0].context.path).toBe("/monitor/s-pen/pen");
    expect(tool.calls[0].context.semantics).toBeUndefined();
    expect(tool.calls[0].context.eventContext).toBeUndefined();
    expect(tool.calls[0].context.runtimeContext).toBeUndefined();
  });

  test("createProcessor 不再默认暴露坐标转换能力", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, context) {
        this.calls.push({ signalPacket, context });
      }

      reset() {
        this.calls = [];
      }
    }

    const tool = new TestTool();
    const processor = tool.createProcessor();

    processor(
      { signals: [{ type: "position", context: { value: { x: 10, y: 20 } } }] },
      {
        path: "/monitor/s-pen/pen",
        context: {},
      },
    );

    expect(tool.calls[0].context.resolvePosition).toBeUndefined();
  });

  test("createProcessor 不应修改传入的 handlerContext", () => {
    class TestTool extends Tool {
      process() {}

      reset() {}
    }

    const tool = new TestTool();
    const handlerContext = {
      path: "/monitor/s-pen/pen",
      context: {},
      getNodeState() {
        return {};
      },
      setNodeState() {
        return {};
      },
    };

    tool.createProcessor()(
      { signals: [{ type: "pressure", context: { value: 0.5 } }] },
      handlerContext,
    );

    expect(handlerContext).toEqual({
      path: "/monitor/s-pen/pen",
      context: {},
      getNodeState: handlerContext.getNodeState,
      setNodeState: handlerContext.setNodeState,
    });
  });

  test("基类 process 仍为抽象方法", () => {
    const tool = new Tool();
    expect(() => tool.process({ to: "/", signals: [] }, {})).toThrow(
      "Method not implemented.",
    );
  });
});
