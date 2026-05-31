import { jest } from "@jest/globals";
import { CircleCreatorTool } from "../circle-creator.js";
import { Vector } from "../../../utils/math.js";

describe("ObjectCreatorTool — property 信号", () => {
  test("Phase 1 带 property 信号 → 对象使用注入属性覆盖默认属性", () => {
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#000", fillColor: "#fff" },
    });
    const deviceContext = { objectId: 201, ownerChunkId: 1 };

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          {
            type: "position",
            context: { value: new Vector(5, 5) },
          },
          {
            type: "property",
            context: {
              value: { strokeColor: "hsl(120, 70%, 42%)", width: 3 },
            },
          },
        ],
      },
      deviceContext,
    );

    expect(tool.obj).toBeDefined();
    expect(tool.obj.property.strokeColor).toBe("hsl(120, 70%, 42%)");
    expect(tool.obj.property.width).toBe(3);
    // fillColor 无覆盖，保持默认
    expect(tool.obj.property.fillColor).toBe("#fff");
  });

  test("property 信号为 null / 非对象 → injectedProperty 为 null，对象使用默认属性", () => {
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#000" },
    });
    const deviceContext = { objectId: 202, ownerChunkId: 1 };

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(0, 0) } },
          { type: "property", context: { value: null } },
        ],
      },
      deviceContext,
    );

    expect(tool.obj).toBeDefined();
    expect(tool.obj.property.strokeColor).toBe("#000");
  });

  test("无 property 信号 → 对象使用默认属性", () => {
    const tool = new CircleCreatorTool({
      property: { strokeColor: "#abc" },
    });
    const deviceContext = { objectId: 203, ownerChunkId: 1 };

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(3, 4) } }],
      },
      deviceContext,
    );

    expect(tool.obj).toBeDefined();
    expect(tool.obj.property.strokeColor).toBe("#abc");
  });

  test("buildInteractionContext 在基类中提取 injectedProperty", () => {
    const tool = new CircleCreatorTool();
    const deviceContext = { objectId: 204, ownerChunkId: 1 };

    const interaction = tool.buildInteractionContext(
      {
        to: "/",
        signals: [
          { type: "position", context: { value: { x: 1, y: 2 } } },
          { type: "property", context: { value: { width: 5 } } },
        ],
      },
      deviceContext,
    );

    expect(interaction.injectedProperty).toEqual({ width: 5 });
    expect(interaction.position).toEqual(new Vector(1, 2));
  });

  test("property 为数组值 → injectedProperty 为 null", () => {
    const tool = new CircleCreatorTool();
    const deviceContext = { objectId: 205, ownerChunkId: 1 };

    const interaction = tool.buildInteractionContext(
      {
        to: "/",
        signals: [
          { type: "position", context: { value: { x: 0, y: 0 } } },
          { type: "property", context: { value: ["invalid", "array"] } },
        ],
      },
      deviceContext,
    );

    expect(interaction.injectedProperty).toBeNull();
  });
});
