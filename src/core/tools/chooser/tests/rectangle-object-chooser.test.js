import { jest } from "@jest/globals";
import { RectangleObjectChooserTool } from "../rectangle-object-chooser.js";
import { Vector } from "../../../utils/math.js";
import { RectangleRange } from "../../../range/index.js";
import { createStateAccess } from "../../../test-support/state-fixtures.js";

describe("RectangleObjectChooserTool", () => {
  test("拖拽结束后应选择与矩形相交的对象并清理拖拽状态", () => {
    const tool = new RectangleObjectChooserTool();
    const firstObject = {
      id: 1,
      position: new Vector(10, 10),
      getRange() {
        return new RectangleRange(0, 0, 20, 20);
      },
    };
    const secondObject = {
      id: 2,
      position: new Vector(100, 100),
      getRange() {
        return new RectangleRange(0, 0, 20, 20);
      },
    };
    const stateAccess = createStateAccess();
    const board = {
      objectLoaded: new Map([
        [1, { obj: firstObject }],
        [2, { obj: secondObject }],
      ]),
      activeObjectManager: {
        choose: jest.fn(),
        discard: jest.fn(),
        activeObjectIndex: new Map(),
      },
    };
    const deviceContext = {
      board,
      monitor: { requestViewportUiRender: jest.fn() },
      path: "/main/mouse/secondary/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.process(
      {
        signals: [
          {
            type: "position",
            context: { value: new Vector(5, 5) },
          },
        ],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          {
            type: "position",
            context: { value: new Vector(40, 40) },
          },
        ],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          {
            type: "position",
            context: { value: new Vector(40, 40) },
          },
          {
            type: "end",
            context: {},
          },
        ],
      },
      deviceContext,
    );

    expect(board.activeObjectManager.choose).toHaveBeenCalledWith(
      new Set([firstObject]),
    );
    expect(deviceContext.object).toBe(firstObject);
    expect(stateAccess.getState()).toEqual({
      object: firstObject,
      objects: [firstObject],
    });
  });

  test("空框选应清空上一轮选择", () => {
    const tool = new RectangleObjectChooserTool();
    const previousObject = { id: 1 };
    const stateAccess = createStateAccess({
      object: previousObject,
      objects: [previousObject],
    });
    const board = {
      objectLoaded: new Map([[1, { obj: previousObject }]]),
      activeObjectManager: {
        choose: jest.fn(),
        discard: jest.fn(),
        activeObjectIndex: new Map([[1, previousObject]]),
        getObjectWorldRange() {
          return new RectangleRange(100, 100, 10, 10);
        },
      },
    };
    const deviceContext = {
      board,
      monitor: { requestViewportUiRender: jest.fn() },
      path: "/main/mouse/secondary/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.process(
      {
        signals: [
          {
            type: "position",
            context: { value: new Vector(0, 0) },
          },
        ],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          {
            type: "position",
            context: { value: new Vector(10, 10) },
          },
          {
            type: "end",
            context: {},
          },
        ],
      },
      deviceContext,
    );

    expect(board.activeObjectManager.discard).toHaveBeenCalledWith(
      new Set([previousObject]),
    );
    expect(board.activeObjectManager.choose).not.toHaveBeenCalled();
    expect(stateAccess.getState()).toEqual({});
  });

  test("框选应基于对象主判定范围而不是 boundingBox", () => {
    const tool = new RectangleObjectChooserTool();
    const objectEntry = {
      id: 3,
      position: new Vector(100, 100),
      boundingBox: new RectangleRange(0, 0, 60, 60),
      getRange() {
        return new RectangleRange(50, 50, 10, 10);
      },
    };
    const stateAccess = createStateAccess();
    const board = {
      objectLoaded: new Map([[3, { obj: objectEntry }]]),
      activeObjectManager: {
        choose: jest.fn(),
        discard: jest.fn(),
        activeObjectIndex: new Map(),
      },
    };
    const deviceContext = {
      board,
      monitor: { requestViewportUiRender: jest.fn() },
      path: "/main/mouse/secondary/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(100, 100) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(120, 120) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(board.activeObjectManager.choose).not.toHaveBeenCalled();
    expect(stateAccess.getState()).toEqual({});
  });

  test("collectUiOverlayEntries 应同时返回拖拽矩形和父类选择框条目", () => {
    const tool = new RectangleObjectChooserTool();
    const stateAccess = createStateAccess({
      selectionStart: new Vector(0, 0),
      selectionCurrent: new Vector(20, 30),
      selectionWorldRect: new RectangleRange(0, 0, 20, 30),
      object: { id: 1 },
      objects: [{ id: 1 }],
    });
    const renderer = {
      createCompatSelectionEntriesForObjects: jest.fn(() => ["selection-frame"]),
    };

    expect(
      tool.collectUiOverlayEntries({
        deviceContext: {
          path: "/main/mouse/secondary/tool",
          getNodeState: stateAccess.getState,
          setNodeState: stateAccess.setState,
          object: { id: 1 },
          objects: [{ id: 1 }],
        },
        renderer,
      }),
    ).toEqual([
      "selection-frame",
      expect.objectContaining({
        source: "rectangle-selection-drag",
        worldRect: new RectangleRange(0, 0, 20, 30),
      }),
    ]);
  });
});