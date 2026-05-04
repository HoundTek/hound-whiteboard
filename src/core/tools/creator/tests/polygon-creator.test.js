import { PolygonCreatorTool } from "../polygon-creator.js";
import { Vector } from "../../../../utils/math.js";

describe("PolygonCreatorTool", () => {
  test("PolygonCreatorTool 应在同一手势内更新当前顶点，并在 end 时固化", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { objectId: 10, pageId: 1 };

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "position", context: { value: new Vector(8, 9) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [
            { type: "position", context: { value: new Vector(10, 12) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.obj.points.map((point) => point.serialize())).toEqual([
      { x: 10, y: 12 },
    ]);

    expect(tool.count).toBe(1);

    expect(tool.lastPoint.serialize()).toEqual({ x: 10, y: 12 });
  });
});
