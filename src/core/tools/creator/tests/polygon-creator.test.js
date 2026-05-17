import { PolygonCreatorTool } from "../polygon-creator.js";
import { Vector } from "../../../utils/math.js";
import { OBJECT_CREATOR_SIGNAL_TYPES } from "../obj-creator.js";

describe("PolygonCreatorTool", () => {
  test("PolygonCreatorTool 应在同一手势内更新当前顶点，并在 end 时固化", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { objectId: 10, ownerPageId: 1 };

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

    expect(tool.obj.localPolygonRange.points.map((point) => point.serialize())).toEqual([
      { x: 10, y: 12 },
    ]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("cancel 信号应重置当前手势", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { objectId: 10, ownerPageId: 1 };

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [
            { type: "position", context: { value: new Vector(5, 5) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.count).toBe(1);

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "cancel", context: {} }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.obj.localPolygonRange.points.map((point) => point.serialize())).toEqual([
      { x: 5, y: 5 },
    ]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-cancel 信号应取消整个多边形对象", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { objectId: 10, ownerPageId: 1 };

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [
            { type: "position", context: { value: new Vector(5, 5) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "object-cancel", context: {} }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.obj).toBeNull();
    expect(tool.count).toBe(0);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-end 信号应固化整个多边形对象", () => {
    const tool = new PolygonCreatorTool();
    const deviceContext = { objectId: 10, ownerPageId: 1 };

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [
            { type: "position", context: { value: new Vector(5, 5) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/monitor/polygon",
          signals: [{ type: "object-end", context: {} }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool.obj.localPolygonRange.points.map((point) => point.serialize())).toEqual([
      { x: 5, y: 5 },
    ]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });
});
