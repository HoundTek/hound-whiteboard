import { jest } from "@jest/globals";
import { CircleCreatorTool } from "../circle-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board } from "../../../components/board.js";
import { ChunkObjectManager } from "../../../components/chunk-object-manager.js";

describe("CircleCreatorTool", () => {
  test("单手势起点为圆心，终点决定半径", () => {
    const tool = new CircleCreatorTool();
    const deviceContext = { acc: {}, objectId: 101, ownerChunkId: 1 };

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

    expect(tool.obj).toBeDefined();
    expect(tool.obj.position.serialize()).toEqual({ x: 1, y: 2 });
    expect(tool.obj.radius).toBeCloseTo(Math.sqrt(145));
  });

  test("结束点过近时使用固定半径，固定半径由 monitor.zoom 决定", () => {
    const tool = new CircleCreatorTool();
    const deviceContext = {
      acc: { monitor: { zoom: 2 } },
      objectId: 102,
      ownerChunkId: 2,
    };

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

    expect(tool.obj.radius).toBeCloseTo(8);
  });

  test("生成对象时应使用 board.activeObjectManager.apply 完成提交", () => {
    const tool = new CircleCreatorTool();
    const board = {
      activeObjectManager: {
        add: jest.fn(),
        apply: jest.fn(),
      },
    };
    const deviceContext = {
      acc: { board },
      objectId: 103,
      ownerChunkId: 3,
    };

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(2, 1) } }],
      },
      deviceContext,
    );

    const createdObject = tool.obj;
    expect(board.activeObjectManager.add).toHaveBeenCalledWith(
      new Set([createdObject]),
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
      new Set([createdObject]),
    );
  });

  test("未提供 monitor 时应以默认 zoom=1 计算固定半径", () => {
    const tool = new CircleCreatorTool();
    const deviceContext = { acc: {}, objectId: 401, ownerChunkId: 1 };

    // 起始点与结束点距离仅 1 像素，小于 minDragDistanceScreen=4 → 应用固定半径
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

    expect(tool.obj.radius).toBeCloseTo(16);
  });

  test("真实 Board 上结束手势后应将对象写回归属区块", () => {
    const tool = new CircleCreatorTool();
    const board = new Board();
    board.width = 10;
    board.height = 10;
    board.getChunkById(1).objectManager = new ChunkObjectManager(1);

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(1, 1) } }],
      },
      { acc: { board }, objectId: 110, ownerChunkId: 1 },
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "end", context: {} }],
      },
      { acc: { board }, objectId: 110, ownerChunkId: 1 },
    );

    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(board.getChunkById(1).objectManager.getObject(110)).toBe(tool.obj);
  });

  test("连续两次创建应生成两个不同圆对象", () => {
    const board = new Board();
    board.width = 10;
    board.height = 10;
    board.getChunkById(1).objectManager = new ChunkObjectManager(1);

    const tool = new CircleCreatorTool();

    // 第一次创建
    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { acc: { board }, objectId: 201, ownerChunkId: 1 },
    );

    const firstObject = tool.obj;

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(5, 5) } },
          { type: "end", context: {} },
        ],
      },
      { acc: { board }, objectId: 201, ownerChunkId: 1 },
    );

    // 第二次创建
    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(6, 7) } }],
      },
      { acc: { board }, objectId: 202, ownerChunkId: 1 },
    );

    const secondObject = tool.obj;

    tool.process(
      {
        to: "/monitor/circle",
        signals: [
          { type: "position", context: { value: new Vector(10, 10) } },
          { type: "end", context: {} },
        ],
      },
      { acc: { board }, objectId: 202, ownerChunkId: 1 },
    );

    expect(firstObject).not.toBe(secondObject);
    expect(firstObject.id).toBe(201);
    expect(secondObject.id).toBe(202);
    expect(board.getChunkById(1).objectManager.getObject(201)).toBe(
      firstObject,
    );
    expect(board.getChunkById(1).objectManager.getObject(202)).toBe(
      secondObject,
    );
  });

  test("起始点与结束点完全相同时应使用固定半径（默认 zoom=1）", () => {
    const tool = new CircleCreatorTool();
    const deviceContext = { acc: {}, objectId: 301, ownerChunkId: 1 };

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

    expect(tool.obj.radius).toBeCloseTo(16);
    expect(tool.obj.position.serialize()).toEqual({ x: 10, y: 10 });
  });
});
