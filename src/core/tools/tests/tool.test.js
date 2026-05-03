import { Tool } from "../tool.js";

describe("Tool", () => {
  test("normalizeSignalPacket 应规整缺省字段", () => {
    expect(Tool.normalizeSignalPacket()).toEqual({
      to: "",
      signals: [],
    });

    expect(Tool.normalizeSignalPacket({ to: "/monitor" })).toEqual({
      to: "/monitor",
      signals: [],
    });
  });

  test("createSignal 应构造标准信号对象", () => {
    expect(Tool.createSignal("pressure", { value: 0.5 })).toEqual({
      type: "pressure",
      context: { value: 0.5 },
    });
  });

  test("normalizeProcessResult 应规整单个或多个信号包", () => {
    expect(
      Tool.normalizeProcessResult({
        to: "/monitor/device",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      }),
    ).toEqual([
      {
        to: "/monitor/device",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      },
    ]);

    expect(
      Tool.normalizeProcessResult([
        {
          to: "/a",
          signals: [{ type: "end", context: {} }],
        },
        {
          to: "/b",
          signals: [{ type: "cancel", context: {} }],
        },
      ]),
    ).toEqual([
      {
        to: "/a",
        signals: [{ type: "end", context: {} }],
      },
      {
        to: "/b",
        signals: [{ type: "cancel", context: {} }],
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