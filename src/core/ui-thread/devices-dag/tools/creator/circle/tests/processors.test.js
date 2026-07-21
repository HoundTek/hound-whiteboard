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

describe("transform 补丁", () => {
  test("applyGesturePatch 写入 transform 后，外接框解析应考虑 transform", () => {
    const tool = new CircleDataCreatorTool({
      processor: createCircleRadiusProcessor(),
    });
    const { deviceContext } = createBoardDeviceContext(601);
    const boardApi = deviceContext.services.boardApi;

    processGesture(tool, deviceContext, [new Vector(0, 0), new Vector(8, 0)]);

    tool.applyGesturePatch(
      { transform: { a: 2, b: 0, c: 0, d: 1 } },
      { context: deviceContext },
    );

    expect(tool._entry.transform).toEqual({ a: 2, b: 0, c: 0, d: 1 });
    expect(boardApi.modifyObject).toHaveBeenCalledWith(
      601,
      expect.objectContaining({
        transform: { a: 2, b: 0, c: 0, d: 1 },
      }),
    );
    expect(tool.resolveCreatedObjectBoundingBox({})).toEqual({
      left: -16,
      top: -8,
      width: 32,
      height: 16,
    });
  });
});
