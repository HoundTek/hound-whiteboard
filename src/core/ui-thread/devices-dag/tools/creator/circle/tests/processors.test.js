import { jest } from "@jest/globals";
import { CircleDataCreatorTool } from "../data-creator.js";
import {
  interpretCircleRadius,
  createCircleRadiusProcessor,
} from "../radius-processor.js";
import {
  interpretCircleDiameter,
  createCircleDiameterProcessor,
} from "../diameter-processor.js";
import {
  interpretCircleBounding,
  createCircleBoundingProcessor,
} from "../bounding-processor.js";
import { Vector } from "../../../../../../engine/utils/math.js";

function createBoardDeviceContext(objectId, { viewport } = {}) {
  const board = {
    allocateObjectId: jest.fn(() => objectId),
    getObjectById: jest.fn(() => undefined),
  };
  const boardApi = {
    createObject: jest.fn(async () => objectId),
    modifyObject: jest.fn(),
    commitObjects: jest.fn(),
    discardActiveObjects: jest.fn(),
  };

  return {
    deviceContext: {
      services: {
        board,
        boardApi,
        viewport,
      },
    },
  };
}

function processGesture(tool, deviceContext, points) {
  tool.process(
    {
      signals: [{ type: "position", context: { value: points[0] } }],
    },
    deviceContext,
  );
  for (const point of points.slice(1, -1)) {
    tool.process(
      { signals: [{ type: "position", context: { value: point } }] },
      deviceContext,
    );
  }
  tool.process(
    {
      signals: [
        { type: "position", context: { value: points[points.length - 1] } },
        { type: "end", context: {} },
      ],
    },
    deviceContext,
  );
}

describe("interpret 纯函数", () => {
  test("圆心+半径：半径为当前点到锚点的距离，不含位置补丁", () => {
    const patch = interpretCircleRadius(new Vector(1, 2), new Vector(4, 6));
    expect(patch.position).toBeUndefined();
    expect(patch.transform).toBeUndefined();
    expect(patch.data.radius).toBeCloseTo(5);
  });

  test("直径：位置为中点，半径为距离的一半", () => {
    const patch = interpretCircleDiameter(new Vector(0, 0), new Vector(6, 8));
    expect(patch.position.serialize()).toEqual({ x: 3, y: 4 });
    expect(patch.data.radius).toBeCloseTo(5);
  });

  test("外接矩形：短轴分量恒为单位，长轴分量 ≥ 1", () => {
    const wide = interpretCircleBounding(new Vector(0, 0), new Vector(10, 6));
    expect(wide.position.serialize()).toEqual({ x: 5, y: 3 });
    expect(wide.data.radius).toBeCloseTo(3);
    expect(wide.transform).toEqual({ a: 10 / 6, b: 0, c: 0, d: 1 });
    expect(Math.min(Math.abs(wide.transform.a), Math.abs(wide.transform.d))).toBe(1);

    const tall = interpretCircleBounding(new Vector(0, 0), new Vector(6, 10));
    expect(tall.transform).toEqual({ a: 1, b: 0, c: 0, d: 10 / 6 });
    expect(Math.min(Math.abs(tall.transform.a), Math.abs(tall.transform.d))).toBe(1);
  });

  test("外接矩形：零点尺寸退化为半径 0 的正圆", () => {
    const patch = interpretCircleBounding(new Vector(3, 3), new Vector(3, 3));
    expect(patch.position.serialize()).toEqual({ x: 3, y: 3 });
    expect(patch.data.radius).toBe(0);
    expect(patch.transform).toEqual({ a: 1, b: 0, c: 0, d: 1 });
  });
});

describe("直径手势端到端", () => {
  test("拖出直径后圆心为中点、半径为距离一半，补丁经 modifyObject 发出", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleDiameterProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(501);
    const boardApi = deviceContext.services.boardApi;

    processGesture(
      tool,
      deviceContext,
      [new Vector(0, 0), new Vector(6, 0)],
    );

    expect(tool._entry.position.serialize()).toEqual({ x: 3, y: 0 });
    expect(tool._entry.data.radius).toBeCloseTo(3);
    expect(boardApi.modifyObject).toHaveBeenCalledWith(
      501,
      expect.objectContaining({
        position: expect.objectContaining({ x: 3, y: 0 }),
        data: { radius: 3 },
      }),
    );
    expect(boardApi.commitObjects).toHaveBeenCalledWith([501]);
  });

  test("点击未拖动时使用固定半径", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleDiameterProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(502);

    processGesture(tool, deviceContext, [new Vector(2, 2), new Vector(2, 2)]);

    expect(tool._entry.data.radius).toBeCloseTo(16);
  });
});

describe("外接矩形手势端到端", () => {
  test("拖出外接矩形后生成 transform 表达的椭圆", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleBoundingProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(601);
    const boardApi = deviceContext.services.boardApi;

    processGesture(
      tool,
      deviceContext,
      [new Vector(0, 0), new Vector(24, 16)],
    );

    expect(tool._entry.position.serialize()).toEqual({ x: 12, y: 8 });
    expect(tool._entry.data.radius).toBeCloseTo(8);
    expect(tool._entry.transform).toEqual({ a: 1.5, b: 0, c: 0, d: 1 });
    expect(boardApi.modifyObject).toHaveBeenCalledWith(
      601,
      expect.objectContaining({
        data: { radius: 8 },
        transform: { a: 1.5, b: 0, c: 0, d: 1 },
      }),
    );
  });

  test("外接矩形的外接框解析考虑 transform", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleBoundingProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(602);

    processGesture(
      tool,
      deviceContext,
      [new Vector(0, 0), new Vector(24, 16)],
    );

    expect(tool.resolveCreatedObjectBoundingBox({})).toEqual({
      left: -12,
      top: -8,
      width: 24,
      height: 16,
    });
  });

  test("点击未拖动时生成固定半径的正圆", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleBoundingProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(603);

    processGesture(tool, deviceContext, [new Vector(5, 5), new Vector(5, 5)]);

    expect(tool._entry.position.serialize()).toEqual({ x: 5, y: 5 });
    expect(tool._entry.data.radius).toBeCloseTo(16);
    expect(tool._entry.transform).toEqual({ a: 1, b: 0, c: 0, d: 1 });
  });
});
