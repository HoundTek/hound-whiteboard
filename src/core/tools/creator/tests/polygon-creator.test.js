import { PolygonCreatorTool } from "../polygon-creator.js";
import { Vector } from "../../../utils/math.js";
import { Board } from "../../../components/board.js";
import { PageObjectManager } from "../../../components/page-object-manager.js";
import { OBJECT_CREATOR_SIGNAL_TYPES } from "../obj-creator.js";
import { jest } from "@jest/globals";

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

    expect(
      tool.obj.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 5, y: 7 }]);
    expect(tool.obj.position.serialize()).toEqual({ x: 5, y: 5 });
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

    expect(
      tool.obj.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 0, y: 0 }]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-cancel 信号应取消整个多边形对象并撤销 AOM 注册", () => {
    const tool = new PolygonCreatorTool();
    const board = {
      activeObjectManager: { add: jest.fn(), discard: jest.fn() },
    };
    const deviceContext = { objectId: 10, ownerPageId: 1, board };

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

    expect(board.activeObjectManager.discard).toHaveBeenCalledWith(
      new Set([expect.anything()]),
    );
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

    expect(
      tool.obj.localPolygonRange.points.map((point) => point.serialize()),
    ).toEqual([{ x: 0, y: 0 }]);
    expect(tool.count).toBe(1);
    expect(tool.lastPoint).toBeNull();
  });

  test("object-end 后应将对象交给 activeObjectManager.apply", () => {
    const tool = new PolygonCreatorTool();
    const board = {
      addObject: jest.fn(),
      activeObjectManager: { apply: jest.fn() },
    };

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          {
            type: OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
            context: { value: new Vector(5, 5) },
          },
          { type: OBJECT_CREATOR_SIGNAL_TYPES.END, context: {} },
        ],
      },
      { objectId: 10, ownerPageId: 1, board },
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      { objectId: 10, ownerPageId: 1, board },
    );

    expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
      new Set([createdObject]),
    );
    expect(board.addObject).not.toHaveBeenCalled();
  });

  test("真实 Board 上 object-end 后应经由 AOM.apply 落回归属页", () => {
    const tool = new PolygonCreatorTool();
    const board = new Board();
    board.width = 10;
    board.height = 10;
    board.pageOrder = [1];
    board.pageIds = new Set(board.pageOrder);
    board.getPageById(1).objectManager = new PageObjectManager(1);

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          {
            type: OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
            context: { value: new Vector(5, 5) },
          },
          { type: OBJECT_CREATOR_SIGNAL_TYPES.END, context: {} },
        ],
      },
      { objectId: 23, ownerPageId: 1, board },
    );

    const createdObject = tool.obj;

    tool.process(
      {
        to: "/monitor/polygon",
        signals: [
          { type: OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END, context: {} },
        ],
      },
      { objectId: 23, ownerPageId: 1, board },
    );

    const ownerPage = board.getPageById(1);
    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerPage.objectManager.pageObjects.get(23)).toBe(createdObject);
  });
});
