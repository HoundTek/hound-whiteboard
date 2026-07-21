import { jest } from "@jest/globals";
import { EllipseDataCreatorTool } from "../data-creator.js";
import { createEllipseBoundingProcessor } from "../bounding-processor.js";
import { Vector } from "../../../../../../engine/utils/math.js";

function createTool(options = {}) {
  return new EllipseDataCreatorTool({
    processor: createEllipseBoundingProcessor(),
    ...options,
  });
}

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

describe("EllipseDataCreatorTool（外接矩形手势）", () => {
  test("processor 为必传参数，缺失时抛错", () => {
    expect(() => new EllipseDataCreatorTool()).toThrow();
    expect(() => new EllipseDataCreatorTool({})).toThrow();
  });

  test("拖拽外接矩形应创建双轴半径椭圆并通过 RPC 提交", () => {
    const tool = createTool();
    const { deviceContext } = createBoardDeviceContext(101);
    const boardApi = deviceContext.services.boardApi;

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(0, 0) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(24, 16) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.createObject).toHaveBeenCalledWith(
      "EllipseObject",
      expect.objectContaining({ id: 101, position: new Vector(0, 0) }),
    );
    expect(boardApi.modifyObject).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        position: expect.objectContaining({ x: 12, y: 8 }),
        data: { radiusX: 12, radiusY: 8 },
      }),
    );
    expect(boardApi.commitObjects).toHaveBeenCalledWith([101]);
    expect(tool._entry.position.serialize()).toEqual({ x: 12, y: 8 });
    expect(tool._entry.data).toEqual({ radiusX: 12, radiusY: 8 });
  });

  test("点击未拖动时应生成固定半径的正圆椭圆", () => {
    const tool = createTool();
    const { deviceContext } = createBoardDeviceContext(102);

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(5, 5) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool._entry.position.serialize()).toEqual({ x: 5, y: 5 });
    expect(tool._entry.data).toEqual({ radiusX: 16, radiusY: 16 });
  });

  test("连续两次创建应生成两个不同椭圆对象", () => {
    const tool = createTool();
    const { deviceContext } = createBoardDeviceContext(201);
    const board = deviceContext.services.board;
    const boardApi = deviceContext.services.boardApi;
    board.allocateObjectId = jest
      .fn()
      .mockReturnValueOnce(201)
      .mockReturnValueOnce(202);
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(0, 0) } }],
      },
      { services: { board, boardApi } },
    );
    const firstObject = tool._entry;
    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(20, 10) } },
          { type: "end", context: {} },
        ],
      },
      { services: { board, boardApi } },
    );

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(40, 40) } }],
      },
      { services: { board, boardApi } },
    );
    const secondObject = tool._entry;
    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(60, 60) } },
          { type: "end", context: {} },
        ],
      },
      { services: { board, boardApi } },
    );

    expect(firstObject).not.toBe(secondObject);
    expect(firstObject.id).toBe(201);
    expect(secondObject.id).toBe(202);
    expect(commitSpy).toHaveBeenNthCalledWith(1, [201]);
    expect(commitSpy).toHaveBeenNthCalledWith(2, [202]);
  });

  test("完成创建后应按双轴半径解析局部外接矩形", () => {
    const tool = createTool();
    const { deviceContext } = createBoardDeviceContext(301);

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(0, 0) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(24, 16) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool.resolveCreatedObjectBoundingBox({})).toEqual({
      left: -12,
      top: -8,
      width: 24,
      height: 16,
    });
    expect(tool._entry.boundingBox).toEqual({
      left: -12,
      top: -8,
      width: 24,
      height: 16,
    });
  });
});
