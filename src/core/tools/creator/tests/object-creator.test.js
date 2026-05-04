import { StrokeCreatorTool } from "../stroke.js";
import { PolygonCreatorTool } from "../polygon.js";
import { Vector } from "../../../../utils/math.js";

describe("ObjectCreatorTool", () => {
  test("StrokeCreatorTool 应消费 position/end 信号并累计点列", () => {
    const tool = new StrokeCreatorTool();
    const deviceContext = { objectId: 100, pageId: 2 };

    expect(tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    )).toBeUndefined();
    expect(tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    )).toBeUndefined();
    expect(tool.process(
      {
        to: "/monitor/stroke",
        signals: [
          { type: "position", context: { value: new Vector(3, 4) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    )).toBeUndefined();

    expect(tool.obj.id).toBe(100);
    expect(tool.obj.pageId).toBe(2);
    expect(tool.obj.points.map((point) => point.serialize())).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 4 },
      { x: 3, y: 4 },
    ]);
  });

  test("cancel 信号应重置正在创建的对象", () => {
    const tool = new StrokeCreatorTool();

    expect(tool.process(
      {
        to: "/monitor/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { objectId: 1, pageId: 1 },
    )).toBeUndefined();
    expect(tool.process({
      to: "/monitor/stroke",
      signals: [{ type: "cancel", context: {} }],
    })).toBeUndefined();

    expect(tool.obj).toBeNull();
  });

  test("PolygonCreatorTool 应在同一手势内更新当前顶点，并在 end 时固化", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { objectId: 10, pageId: 1 };

    expect(tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
      },
      deviceContext,
    )).toBeUndefined();
    expect(tool.process(
      {
        to: "/monitor/polygon",
        signals: [{ type: "position", context: { value: new Vector(8, 9) } }],
      },
      deviceContext,
    )).toBeUndefined();
    expect(tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: "position", context: { value: new Vector(10, 12) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    )).toBeUndefined();

    expect(tool.obj.points.map((point) => point.serialize())).toEqual([
      { x: 10, y: 12 },
    ]);
    expect(tool.count).toBe(1);
    expect(tool.vertixControllers).toHaveLength(1);
    expect(tool.lastPoint.serialize()).toEqual({ x: 10, y: 12 });
  });
});