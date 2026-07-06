import { SignalPacket } from "../signal.js";

describe("SignalPacket", () => {
  test("SignalPacket.from 应规整工具侧缺省字段", () => {
    expect(SignalPacket.from()).toBeInstanceOf(SignalPacket);
    expect(SignalPacket.from()).toEqual({
      to: "",
      signals: [],
    });

    expect(SignalPacket.from({ to: "/viewport" })).toBeInstanceOf(SignalPacket);
    expect(SignalPacket.from({ to: "/viewport" })).toEqual({
      to: "/viewport",
      signals: [],
    });
  });

  test("SignalPacket.normalizeResult 应规整工具处理结果为 SignalPacket 列表", () => {
    expect(SignalPacket.normalizeResult()).toEqual([]);
    expect(SignalPacket.normalizeResult(null)).toEqual([]);
    expect(SignalPacket.normalizeResult(undefined)).toEqual([]);

    const packet = new SignalPacket("/viewport", [{ type: "position" }]);
    expect(SignalPacket.normalizeResult(packet)).toEqual([packet]);
    expect(SignalPacket.normalizeResult([packet])).toEqual([packet]);
    expect(
      SignalPacket.normalizeResult({ to: "/viewport", signals: [] }),
    ).toEqual([{ to: "/viewport", signals: [] }]);
  });
});
