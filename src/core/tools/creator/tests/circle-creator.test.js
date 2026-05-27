import { jest } from "@jest/globals";
import { CircleCreatorTool } from "../circle-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board } from "../../../components/board.js";
import { ChunkObjectManager } from "../../../components/chunk-object-manager.js";

describe("CircleCreatorTool", () => {
  test("单手势起点为圆心，终点决定半径", () => {
    const tool = new CircleCreatorTool();
    const deviceContext = { objectId: 101, ownerChunkId: 1 };

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
    const deviceContext = { objectId: 102, ownerChunkId: 2, monitor: { zoom: 2 } };

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
    const deviceContext = { objectId: 103, ownerChunkId: 3, board };

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "position", context: { value: new Vector(2, 1) } }],
      },
      deviceContext,
    );

    const createdObject = tool.obj;
    expect(board.activeObjectManager.add).toHaveBeenCalledWith(new Set([createdObject]));

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(board.activeObjectManager.apply).toHaveBeenCalledWith(new Set([createdObject]));
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
      { objectId: 110, ownerChunkId: 1, board },
    );

    tool.process(
      {
        to: "/monitor/circle",
        signals: [{ type: "end", context: {} }],
      },
      { objectId: 110, ownerChunkId: 1, board },
    );

    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(board.getChunkById(1).objectManager.getObject(110)).toBe(tool.obj);
  });
});
