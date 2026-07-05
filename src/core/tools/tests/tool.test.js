import { jest } from "@jest/globals";
import { Tool } from "../tool.js";

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
        acc: { customFlag: true },
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
            customFlag: true,
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

    const board = {
      allocateObjectId() {
        return 7;
      },
    };
    const tool = new TestTool();
    const processor = tool.createProcessor();

    processor(
      { signals: [{ type: "pressure", context: { value: 0.5 } }] },
      {
        path: "/monitor/s-pen/pen",
        context: {},
        acc: { board },
      },
    );

    expect(tool.calls[0].context.acc.board.allocateObjectId()).toBe(7);
  });

  test("createProcessor 应优先使用累积 context 中显式提供的 allocateObjectId", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, context) {
        this.calls.push({ signalPacket, context });
      }

      reset() {
        this.calls = [];
      }
    }

    const board = {
      allocateObjectId() {
        return 7;
      },
    };
    const explicitAllocateObjectId = jest.fn(() => 11);
    const tool = new TestTool();

    tool.createProcessor()(
      { signals: [{ type: "pressure", context: { value: 0.5 } }] },
      {
        path: "/monitor/s-pen/pen",
        acc: {
          board,
          allocateObjectId: explicitAllocateObjectId,
        },
      },
    );

    expect(tool.calls[0].context.acc.allocateObjectId()).toBe(11);
    expect(explicitAllocateObjectId).toHaveBeenCalledTimes(1);
  });

  test("createProcessor 应保留传入的 board/monitor 与平面上下文", () => {
    class TestTool extends Tool {
      calls = [];

      process(signalPacket, context) {
        this.calls.push({ signalPacket, context });
      }

      reset() {
        this.calls = [];
      }
    }

    const board = {
      id: "board-context",
      allocateObjectId() {
        return 13;
      },
    };
    const monitor = {
      worldToChunk() {
        return { chunkId: 9 };
      },
    };
    const boardApi = { queryObjects: jest.fn() };
    const tool = new TestTool();

    tool.createProcessor()(
      { signals: [{ type: "trigger", context: {} }] },
      {
        path: "/monitor/s-pen/pen",
        acc: {
          board,
          boardApi,
          monitor,
          customFlag: true,
        },
      },
    );

    expect(tool.calls[0].context).toEqual(
      expect.objectContaining({
        acc: expect.objectContaining({
          board,
          boardApi,
          monitor,
          customFlag: true,
        }),
      }),
    );
    expect(tool.calls[0].context.acc.board.allocateObjectId()).toBe(13);
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
