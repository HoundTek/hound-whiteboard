import { jest } from "@jest/globals";
import { CircleCreatorTool } from "../circle-creator.js";
import { Vector } from "../../../utils/math.js";
function createBoardDeviceContext(objectId, { monitor } = {}) {
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
      acc: {
        board,
        boardApi,
        monitor,
        objectId,
        ownerChunkId: 1,
      },
    },
  };
}

describe("CircleCreatorTool", () => {
  test("单手势起点为圆心，终点决定半径", () => {
    const tool = new CircleCreatorTool();
    const { deviceContext } = createBoardDeviceContext(101);

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(10, 10) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool._entry).toBeDefined();
    expect(tool._entry.position.serialize()).toEqual({ x: 1, y: 2 });
    expect(tool._entry.data.radius).toBeCloseTo(Math.sqrt(145));
  });

  test("结束点过近时使用固定半径，固定半径由 monitor.zoom 决定", () => {
    const tool = new CircleCreatorTool();
    const { deviceContext } = createBoardDeviceContext(102, {
      monitor: { zoom: 2 },
    });

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(0, 0) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(0.5, 0.2) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool._entry.data.radius).toBeCloseTo(8);
  });

  test("显式提供 boardApi 时应通过 RPC 创建并提交圆对象", () => {
    const tool = new CircleCreatorTool();
    const { deviceContext } = createBoardDeviceContext(104);
    const boardApi = deviceContext.acc.boardApi;
    const createSpy = jest.spyOn(boardApi, "createObject");
    const modifySpy = jest.spyOn(boardApi, "modifyObject");
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(2, 1) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(6, 4) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(createSpy).toHaveBeenCalledWith(
      "CircleObject",
      expect.objectContaining({
        id: 104,
        position: new Vector(2, 1),
      }),
    );
    expect(modifySpy).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalledWith([104]);
    expect(tool._entry).toMatchObject({
      id: 104,
      position: new Vector(2, 1),
    });
  });

  test("RPC 风格 boardApi 下应维护本地草稿半径并提交", () => {
    const tool = new CircleCreatorTool();
    const board = {
      allocateObjectId: jest.fn(() => 702),
    };
    const boardApi = {
      createObject: jest.fn(),
      modifyObject: jest.fn(),
      commitObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const deviceContext = {
      acc: {
        board,
        boardApi,
      },
    };

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(2, 1) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(6, 4) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.createObject).toHaveBeenCalledWith(
      "CircleObject",
      expect.objectContaining({
        id: 702,
        position: new Vector(2, 1),
      }),
    );
    expect(boardApi.modifyObject).toHaveBeenCalled();
    expect(boardApi.commitObjects).toHaveBeenCalledWith([702]);
    expect(tool._entry.data.radius).toBeCloseTo(5);
  });

  test("结束手势时应通过 boardApi.commitObjects 提交对象", () => {
    const tool = new CircleCreatorTool();
    const { deviceContext } = createBoardDeviceContext(103);
    const boardApi = deviceContext.acc.boardApi;
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(2, 1) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(commitSpy).toHaveBeenCalledWith([103]);
  });

  test("未提供 monitor 时应以默认 zoom=1 计算固定半径", () => {
    const tool = new CircleCreatorTool();
    const { deviceContext } = createBoardDeviceContext(401);

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(0, 0) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(0, 1) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool._entry.data.radius).toBeCloseTo(16);
  });

  test("结束手势后应通过 commitObjects 提交圆对象", () => {
    const tool = new CircleCreatorTool();
    const { deviceContext } = createBoardDeviceContext(110);
    const boardApi = deviceContext.acc.boardApi;
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(1, 1) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(commitSpy).toHaveBeenCalledWith([110]);
    expect(tool._entry.id).toBe(110);
  });

  test("连续两次创建应生成两个不同圆对象", () => {
    const tool = new CircleCreatorTool();
    const { deviceContext } = createBoardDeviceContext(201);
    const board = deviceContext.acc.board;
    const boardApi = deviceContext.acc.boardApi;
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { acc: { board, boardApi, objectId: 201, ownerChunkId: 1 } },
    );

    const firstObject = tool._entry;

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(5, 5) } },
          { type: "end", context: {} },
        ],
      },
      { acc: { board, boardApi, objectId: 201, ownerChunkId: 1 } },
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(6, 7) } }],
      },
      { acc: { board, boardApi, objectId: 202, ownerChunkId: 1 } },
    );

    const secondObject = tool._entry;

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(10, 10) } },
          { type: "end", context: {} },
        ],
      },
      { acc: { board, boardApi, objectId: 202, ownerChunkId: 1 } },
    );

    expect(firstObject).not.toBe(secondObject);
    expect(firstObject.id).toBe(201);
    expect(secondObject.id).toBe(202);
    expect(commitSpy).toHaveBeenNthCalledWith(1, [201]);
    expect(commitSpy).toHaveBeenNthCalledWith(2, [202]);
  });

  test("起始点与结束点完全相同时应使用固定半径（默认 zoom=1）", () => {
    const tool = new CircleCreatorTool();
    const { deviceContext } = createBoardDeviceContext(301);

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(10, 10) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(10, 10) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool._entry.data.radius).toBeCloseTo(16);
    expect(tool._entry.position.serialize()).toEqual({ x: 10, y: 10 });
  });
});
