import { jest } from "@jest/globals";
import { RectangleObjectChooserTool } from "../rectangle-object-chooser.js";
import { Vector } from "../../../utils/math.js";
import { RectangleRange } from "../../../range/index.js";
import { createStateAccess } from "../../../test-support/state-fixtures.js";

describe("RectangleObjectChooserTool", () => {
  test("拖拽结束后应通过 RPC 选择与矩形相交的对象并清理拖拽状态", async () => {
    const tool = new RectangleObjectChooserTool();
    const stateAccess = createStateAccess();
    const selectedSummary = {
      id: 1,
      type: "CircleObject",
      position: { x: 10, y: 10 },
      range: new RectangleRange(0, 0, 20, 20),
      boundingBox: new RectangleRange(0, 0, 20, 20),
      property: {},
      data: { radius: 10 },
    };

    const boardApi = {
      hitTest: jest.fn(async () => [1]),
      queryObjects: jest.fn(async () => [selectedSummary]),
      addActiveObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };

    const deviceContext = {
      acc: { boardApi, viewport: { requestViewportUiRender: jest.fn() } },
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

    await tool.process(
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

    expect(boardApi.hitTest).toHaveBeenCalledWith(
      new RectangleRange(5, 5, 35, 35),
      "intersect",
    );
    expect(boardApi.queryObjects).toHaveBeenCalledWith([1]);
    expect(boardApi.addActiveObjects).toHaveBeenCalledWith([1]);
    expect(deviceContext.acc.objects).toEqual([selectedSummary]);
    expect(stateAccess.getState()).toEqual({
      objects: [selectedSummary],
    });
  });

  test("空框选应通过 discardActiveObjects 清空上一轮选择", async () => {
    const tool = new RectangleObjectChooserTool();
    const previousSummary = {
      id: 1,
      type: "CircleObject",
      position: { x: 100, y: 100 },
      range: new RectangleRange(0, 0, 10, 10),
      boundingBox: new RectangleRange(0, 0, 10, 10),
      property: {},
      data: { radius: 5 },
    };
    const stateAccess = createStateAccess({
      objects: [previousSummary],
    });
    const boardApi = {
      hitTest: jest.fn(async () => []),
      queryObjects: jest.fn(async () => []),
      addActiveObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const deviceContext = {
      acc: {
        boardApi,
        viewport: { requestViewportUiRender: jest.fn() },
        objects: [previousSummary],
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
            context: { value: new Vector(0, 0) },
          },
        ],
      },
      deviceContext,
    );
    await tool.process(
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

    expect(boardApi.discardActiveObjects).toHaveBeenCalledWith([1]);
    expect(boardApi.addActiveObjects).not.toHaveBeenCalled();
    expect(deviceContext.acc.objects).toBeUndefined();
    expect(stateAccess.getState()).toEqual({});
  });

  test("collectUiOverlayEntries 应返回拖拽矩形，不返回选中对象高亮", () => {
    const tool = new RectangleObjectChooserTool();
    const viewport = {
      zoom: 1,
      worldRectToScreenRect(rect, padding = 0) {
        return RectangleRange.from(rect)?.inflate?.(padding);
      },
    };
    const drawRectEntry = jest.fn();

    tool._overlaySelectedObjects = [
      { id: 1, position: { x: 0, y: 0 }, property: {} },
    ];
    tool._overlayDragState = {
      isSelecting: true,
      worldRect: new RectangleRange(0, 0, 20, 30),
    };

    const entries = tool.collectUiOverlayEntries({
      viewport,
      renderer: { drawRectEntry },
    });

    // 只绘制拖拽过程中的选择矩形框，不绘制选中对象高亮（由 modifier 管理）
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        source: "rectangle-selection-drag",
        worldRect: new RectangleRange(0, 0, 20, 30),
      }),
    );
  });

  test("异步框选应通过 hitTest/queryObjects 读取 summary-like 条目而不读取 stale board 对象", async () => {
    const tool = new RectangleObjectChooserTool();
    const stateAccess = createStateAccess();
    const selectedSummary = {
      id: 121,
      type: "CircleObject",
      position: { x: 12, y: 12 },
      range: new RectangleRange(-10, -10, 20, 20),
      boundingBox: new RectangleRange(-10, -10, 20, 20),
      property: {},
      data: { radius: 10 },
    };
    const boardApi = {
      hitTest: jest.fn(async () => [121]),
      queryObjects: jest.fn(async () => [selectedSummary]),
      addActiveObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const staleBoardObject = {
      id: 121,
      stale: true,
      position: new Vector(999, 999),
      getRange() {
        return new RectangleRange(0, 0, 1, 1);
      },
    };
    const deviceContext = {
      acc: {
        board: {
          getObjectById: jest.fn(() => staleBoardObject),
        },
        boardApi,
        viewport: { requestViewportUiRender: jest.fn() },
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
    await tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(30, 30) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.hitTest).toHaveBeenCalledWith(
      new RectangleRange(0, 0, 30, 30),
      "intersect",
    );
    expect(boardApi.queryObjects).toHaveBeenCalledWith([121]);
    expect(boardApi.addActiveObjects).toHaveBeenCalledWith([121]);
    expect(deviceContext.acc.objects).toEqual([selectedSummary]);
    expect(deviceContext.acc.board.getObjectById).not.toHaveBeenCalled();
    expect(stateAccess.getState()).toEqual({ objects: [selectedSummary] });
  });
});
