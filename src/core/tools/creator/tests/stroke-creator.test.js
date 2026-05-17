import { StrokeCreatorTool } from "../stroke-creator.js";
import { Vector } from "../../../utils/math.js";

describe("StrokeCreatorTool", () => {
  test("StrokeCreatorTool 应消费 position/end 信号并累计点列", () => {
    const tool = new StrokeCreatorTool();
    const deviceContext = { objectId: 100, ownerPageId: 2 };

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [
            { type: "position", context: { value: new Vector(3, 4) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.obj.id).toBe(100);
    expect(tool.obj.ownerPageId).toBe(2);
    expect(tool.obj.localPathRange.points.map((point) => point.serialize())).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 4 },
      { x: 3, y: 4 },
    ]);
  });

  test("单 end 信号应能被正确处理", () => {
    const tool = new StrokeCreatorTool();
    const deviceContext = { objectId: 101, ownerPageId: 3 };

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "end", context: {} }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.obj.id).toBe(101);
    expect(tool.obj.ownerPageId).toBe(3);
    expect(tool.obj.localPathRange.points.map((point) => point.serialize())).toEqual([
      { x: 5, y: 6 },
    ]);
  });

  test("cancel 信号应重置正在创建的对象", () => {
    const tool = new StrokeCreatorTool();

    expect(
      tool.process(
        {
          to: "/monitor/stroke",
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        { objectId: 1, ownerPageId: 1 },
      ),
    ).toBeUndefined();

    expect(
      tool.process({
        to: "/monitor/stroke",
        signals: [{ type: "cancel", context: {} }],
      }),
    ).toBeUndefined();

    expect(tool.obj).toBeNull();
  });
});
