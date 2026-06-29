import { jest } from "@jest/globals";
import { RectangleObjectChooserTool } from "../rectangle-object-chooser.js";
import { Vector } from "../../../utils/math.js";
import { RectangleRange } from "../../../range/index.js";
import { Board } from "../../../components/index.js";
import { ChunkObjectManager } from "../../../components/chunk/chunk-object-manager.js";
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
      acc: { board, monitor: { requestViewportUiRender: jest.fn() } },
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
    expect(deviceContext.acc.objects).toEqual([firstObject]);
    expect(stateAccess.getState()).toEqual({
      objects: [firstObject],
    });
  });

  test("空框选应清空上一轮选择", () => {
    const tool = new RectangleObjectChooserTool();
    const previousObject = { id: 1 };
    const stateAccess = createStateAccess({
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
      acc: { board, monitor: { requestViewportUiRender: jest.fn() } },
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
      acc: { board, monitor: { requestViewportUiRender: jest.fn() } },
      path: "/main/mouse/secondary/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(100, 100) } },
        ],
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
      objects: [{ id: 1 }],
    });
    const renderer = {
      createCompatSelectionEntriesForObjects: jest.fn(() => [
        "selection-frame",
      ]),
    };

    expect(
      tool.collectUiOverlayEntries({
        deviceContext: {
          acc: { objects: [{ id: 1 }] },
          path: "/main/mouse/secondary/tool",
          getNodeState: stateAccess.getState,
          setNodeState: stateAccess.setState,
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

  test("显式提供 boardApi 时应通过 addActiveObjects 完成框选", () => {
    const tool = new RectangleObjectChooserTool();
    const stateAccess = createStateAccess();
    const board = new Board();
    board.width = 100;
    board.height = 100;
    board.getChunkById(1).objectManager = new ChunkObjectManager(1);
    const boardApi = board.getBoardApi();
    const addSpy = jest.spyOn(boardApi, "addActiveObjects");

    boardApi.createObject("CircleObject", {
      id: 101,
      position: { x: 10, y: 10 },
      data: { radius: 10 },
    });
    boardApi.commitObjects([101]);
    boardApi.createObject("CircleObject", {
      id: 102,
      position: { x: 100, y: 100 },
      data: { radius: 10 },
    });
    boardApi.commitObjects([102]);

    const selectedObject = board.getObjectById(101);
    const deviceContext = {
      acc: {
        board,
        boardApi,
        monitor: { requestViewportUiRender: jest.fn() },
      },
      path: "/main/mouse/secondary/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(0, 0) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(30, 30) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(30, 30) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(addSpy).toHaveBeenCalledWith([101]);
    expect(deviceContext.acc.objects).toEqual([selectedObject]);
    expect(stateAccess.getState()).toEqual({ objects: [selectedObject] });
  });

  test("显式提供 boardApi 时空框选应通过 discardActiveObjects 清空上一轮选择", () => {
    const tool = new RectangleObjectChooserTool();
    const board = new Board();
    board.width = 100;
    board.height = 100;
    board.getChunkById(1).objectManager = new ChunkObjectManager(1);
    const boardApi = board.getBoardApi();

    boardApi.createObject("CircleObject", {
      id: 111,
      position: { x: 10, y: 10 },
      data: { radius: 10 },
    });
    boardApi.commitObjects([111]);
    const selectedObject = board.getObjectById(111);
    boardApi.addActiveObjects([111]);

    const addSpy = jest.spyOn(boardApi, "addActiveObjects");
    const discardSpy = jest.spyOn(boardApi, "discardActiveObjects");
    addSpy.mockClear();
    discardSpy.mockClear();

    const stateAccess = createStateAccess({ objects: [selectedObject] });
    const deviceContext = {
      acc: {
        board,
        boardApi,
        monitor: { requestViewportUiRender: jest.fn() },
        objects: [selectedObject],
      },
      path: "/main/mouse/secondary/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.process(
      {
        signals: [
          {
            type: "position",
            context: { value: new Vector(200, 200) },
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
            context: { value: new Vector(220, 220) },
          },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(discardSpy).toHaveBeenCalledWith([111]);
    expect(addSpy).not.toHaveBeenCalled();
    expect(stateAccess.getState()).toEqual({});
    expect(deviceContext.acc.objects).toBeUndefined();
  });
});
