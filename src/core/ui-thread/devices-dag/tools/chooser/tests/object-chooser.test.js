import { jest } from "@jest/globals";
import { ObjectChooserTool } from "../object-chooser.js";
import { RectangleObjectChooserTool } from "../rectangle-object-chooser.js";
import { RectangleRange } from "../../../../../engine/range/index.js";
import { Vector } from "../../../../../engine/utils/math.js";
import { createStateAccess } from "../../../../../test-support/state-fixtures.js";

describe("ObjectChooserTool", () => {
  class TestChooserTool extends ObjectChooserTool {
    constructor(options = {}) {
      super(options);
      this.chosenObjects = options.chosenObjects ?? [];
      this._hasRegion = false;
    }

    updateSelectionRegion(position, context) {
      this._hasRegion = true;
    }

    hasSelectionRegion(context) {
      return this._hasRegion;
    }

    clearSelectionRegion(context = {}) {
      this._hasRegion = false;
    }

    getSelectionRegion(context) {
      return null;
    }

    submitSelection(context) {
      return this.chosenObjects;
    }

    reset() { }
  }

  test("process 应通过 boardApi.addActiveObjects 写回选择结果", () => {
    const chosenObject = { id: 1 };
    const boardApi = {
      addActiveObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const stateAccess = createStateAccess();
    const deviceContext = {
      acc: { boardApi },
      path: "/viewport/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };
    const tool = new TestChooserTool({ chosenObjects: [chosenObject] });

    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(0, 0) } },
          { type: "end" },
        ],
      },
      deviceContext,
    );

    expect(boardApi.addActiveObjects).toHaveBeenCalledWith([1]);
    expect(deviceContext.acc.objects).toEqual([chosenObject]);
    expect(stateAccess.getState()).toEqual({
      objects: [chosenObject],
    });
  });

  test("umount 应通过 boardApi.discardActiveObjects 撤销当前选择并清理上下文", () => {
    const chosenObject = { id: 4 };
    const boardApi = {
      addActiveObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const tool = new TestChooserTool();
    const stateAccess = createStateAccess({
      objects: [chosenObject],
    });
    const deviceContext = {
      acc: { boardApi, objects: [chosenObject] },
      path: "/viewport/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.umount(deviceContext);

    expect(boardApi.discardActiveObjects).toHaveBeenCalledWith([4]);
    expect(deviceContext.acc.objects).toBeUndefined();
    expect(stateAccess.getState()).toEqual({});
  });

  test("显式提供 boardApi 时 process 应走 addActiveObjects 并保留 summary-like 条目", () => {
    const boardApi = {
      addActiveObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const stateAccess = createStateAccess();
    const deviceContext = {
      acc: { boardApi },
      path: "/viewport/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };
    const tool = new TestChooserTool({
      chosenObjects: [
        {
          id: 31,
          position: { x: 10, y: 20 },
          range: new RectangleRange(0, 0, 5, 5),
        },
      ],
    });

    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(0, 0) } },
          { type: "end" },
        ],
      },
      deviceContext,
    );

    expect(boardApi.addActiveObjects).toHaveBeenCalledWith([31]);
    expect(deviceContext.acc.objects).toEqual([
      {
        id: 31,
        position: { x: 10, y: 20 },
        range: new RectangleRange(0, 0, 5, 5),
      },
    ]);
    expect(stateAccess.getState()).toEqual({
      objects: [
        {
          id: 31,
          position: { x: 10, y: 20 },
          range: new RectangleRange(0, 0, 5, 5),
        },
      ],
    });
  });

  test("显式提供 RPC boardApi 时不应回填到本地 stale board 对象", () => {
    const rpcSummary = {
      id: 32,
      position: { x: 12, y: 24 },
      range: new RectangleRange(0, 0, 6, 6),
    };
    const staleBoardObject = { id: 32, stale: true };
    const boardApi = {
      addActiveObjects: jest.fn(),
    };
    const stateAccess = createStateAccess();
    const deviceContext = {
      acc: {
        boardApi,
        board: {
          getObjectById: jest.fn(() => staleBoardObject),
        },
      },
      path: "/viewport/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };
    const tool = new TestChooserTool({
      chosenObjects: [rpcSummary],
    });

    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(0, 0) } },
          { type: "end" },
        ],
      },
      deviceContext,
    );

    expect(boardApi.addActiveObjects).toHaveBeenCalledWith([32]);
    expect(deviceContext.acc.objects).toEqual([rpcSummary]);
    expect(deviceContext.acc.board.getObjectById).not.toHaveBeenCalled();
    expect(stateAccess.getState()).toEqual({ objects: [rpcSummary] });
  });

  test("显式提供 boardApi 时 umount 应走 discardActiveObjects", () => {
    const chosenObject = { id: 41 };
    const discardActiveObjects = jest.fn();
    const tool = new TestChooserTool();
    const stateAccess = createStateAccess({
      objects: [chosenObject],
    });
    const deviceContext = {
      acc: {
        boardApi: {
          discardActiveObjects,
        },
        objects: [chosenObject],
      },
      path: "/viewport/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.umount(deviceContext);

    expect(discardActiveObjects).toHaveBeenCalledWith([41]);
    expect(deviceContext.acc.objects).toBeUndefined();
    expect(stateAccess.getState()).toEqual({});
  });

  test("collectUiOverlayEntries 应调用 factory 生成选择框条目", () => {
    const chosenObject = {
      id: 5,
      position: { x: 10, y: 20 },
      range: new RectangleRange(0, 0, 30, 40),
      property: {},
    };
    const tool = new TestChooserTool();
    const viewport = {
      zoom: 1,
      worldRectToScreenRect(rect, padding = 0) {
        return RectangleRange.from(rect)?.inflate?.(padding);
      },
    };
    const drawRectEntry = jest.fn();

    tool._overlaySelectedObjects = [chosenObject];
    const entries = tool.collectUiOverlayEntries({
      viewport,
      renderer: { drawRectEntry },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].objectId).toBe(5);
    expect(entries[0].type).toBe("rect");
    expect(entries[0].source).toBe("compat-selection-object-frame:chooser");
  });

  test("collectUiOverlayEntries 无选中对象时应返回空数组", () => {
    const tool = new TestChooserTool();

    tool._overlaySelectedObjects = [];
    const entries = tool.collectUiOverlayEntries({
      viewport: {},
      renderer: { drawRectEntry: jest.fn() },
    });

    expect(entries).toEqual([]);
  });

  test("collectUiOverlayEntries 在 summary-like 条目时应走 summaries 入口", () => {
    const chosenObject = {
      id: 51,
      position: { x: 10, y: 20 },
      range: new RectangleRange(0, 0, 5, 5),
    };
    const tool = new TestChooserTool();
    const viewport = {
      zoom: 1,
      worldRectToScreenRect(rect, padding = 0) {
        return RectangleRange.from(rect)?.inflate?.(padding);
      },
    };
    const drawRectEntry = jest.fn();

    tool._overlaySelectedObjects = [chosenObject];
    const visible = tool.collectUiOverlayEntries({
      viewport,
      renderer: { drawRectEntry },
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].objectId).toBe(51);
  });

  test("resolveObjectSelectionWorldRange 应优先使用 range 而非 boundingBox", () => {
    const tool = new TestChooserTool();
    const objectEntry = {
      id: 6,
      position: new Vector(100, 200),
      range: new RectangleRange(10, 20, 5, 6),
      boundingBox: new RectangleRange(0, 0, 40, 50),
    };

    expect(tool.resolveObjectSelectionWorldRange({}, objectEntry)).toEqual(
      new RectangleRange(110, 220, 5, 6),
    );
  });

  test("resolveObjectSelectionWorldRange 应支持 summary-like 条目的 range 字段", () => {
    const tool = new TestChooserTool();
    const objectEntry = {
      id: 7,
      position: new Vector(50, 80),
      range: new RectangleRange(5, 10, 20, 30),
    };

    expect(tool.resolveObjectSelectionWorldRange({}, objectEntry)).toEqual(
      new RectangleRange(55, 90, 20, 30),
    );
  });

  describe("生命周期钩子", () => {
    test("afterChoose 在有选中对象时触发", () => {
      const chosenObject = { id: 10 };
      const boardApi = {
        addActiveObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };
      const stateAccess = createStateAccess();
      const deviceContext = {
        acc: { boardApi },
        path: "/test",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
      };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      const afterChoose = jest.fn();
      tool.on("afterChoose", afterChoose);

      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(0, 0) } },
            { type: "end" },
          ],
        },
        deviceContext,
      );

      expect(afterChoose).toHaveBeenCalledTimes(1);
      expect(afterChoose).toHaveBeenCalledWith([chosenObject]);
    });

    test("afterChoose 在无选中对象时不触发", () => {
      const boardApi = {
        addActiveObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };
      const tool = new TestChooserTool({ chosenObjects: [] });
      const afterChoose = jest.fn();
      tool.on("afterChoose", afterChoose);

      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(0, 0) } },
            { type: "end" },
          ],
        },
        {
          acc: { boardApi },
          path: "/test",
          getNodeState: () => ({}),
          setNodeState: () => { },
        },
      );

      expect(afterChoose).not.toHaveBeenCalled();
    });

    test("confirmSelection → beforeConfirm 返回 false 时阻止后续完成", () => {
      const chosenObject = { id: 11 };
      const board = {
        activeObjectManager: { choose: jest.fn() },
      };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      tool.beforeConfirmSelection = () => false;

      const result = tool.confirmSelection({ acc: { board }, path: "/test" }, [
        chosenObject,
      ]);

      expect(result).toBe(false);
    });

    test("confirmSelection 默认返回 true", () => {
      const chosenObject = { id: 12 };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });

      const result = tool.confirmSelection(
        { acc: { board: {} }, path: "/test" },
        [chosenObject],
      );

      expect(result).toBe(true);
    });

    test("选择确认成功后触发 action:complete", () => {
      const chosenObject = { id: 13 };
      const boardApi = {
        addActiveObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };
      const stateAccess = createStateAccess();
      const deviceContext = {
        acc: { boardApi },
        path: "/test",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
      };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      const actionComplete = jest.fn();
      tool.on("action:complete", actionComplete);

      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(0, 0) } },
            { type: "end" },
          ],
        },
        deviceContext,
      );

      expect(actionComplete).toHaveBeenCalledTimes(1);
      expect(actionComplete).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/test" }),
        [chosenObject],
      );
    });

    test("RectangleObjectChooserTool 在 end 信号时触发 action:complete", async () => {
      // 准备一个虚拟对象用于框选命中
      const selectedSummary = {
        id: 20,
        type: "CircleObject",
        position: { x: 50, y: 50 },
        range: new RectangleRange(0, 0, 10, 10),
        boundingBox: new RectangleRange(0, 0, 10, 10),
        property: {},
        data: {},
      };
      const boardApi = {
        hitTest: jest.fn(async () => [20]),
        queryObjects: jest.fn(async () => [selectedSummary]),
        addActiveObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };
      const stateAccess = createStateAccess();
      const deviceContext = {
        acc: { boardApi },
        path: "/viewport/chooser",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
      };

      const tool = new RectangleObjectChooserTool();
      const actionComplete = jest.fn();
      const afterChoose = jest.fn();
      tool.on("action:complete", actionComplete);
      tool.on("afterChoose", afterChoose);

      // 先发送 position 信号，建立拖拽状态
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

      // 发送 end 信号，携带最终位置 → 框选命中 → confirmSelection
      const completePromise = new Promise((resolve) =>
        tool.on("action:complete", () => resolve()),
      );
      tool.process(
        {
          signals: [
            { type: "end" },
            {
              type: "position",
              context: { value: new Vector(200, 200) },
            },
          ],
        },
        deviceContext,
      );
      await completePromise;

      expect(afterChoose).toHaveBeenCalledTimes(1);
      expect(actionComplete).toHaveBeenCalledTimes(1);

      const completeCall = actionComplete.mock.calls[0];
      expect(completeCall[0]).toMatchObject({ path: "/viewport/chooser" });
      expect(completeCall[1]).toEqual([selectedSummary]);
    });

    test("cancel 信号应撤销上一轮已确认的选择", () => {
      const chosenObject = { id: 15 };
      const boardApi = {
        addActiveObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };
      const stateAccess = createStateAccess();
      const deviceContext = {
        acc: { boardApi },
        path: "/test",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
      };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });

      // 先选择对象
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(0, 0) } },
            { type: "end" },
          ],
        },
        deviceContext,
      );

      expect(boardApi.addActiveObjects).toHaveBeenCalledWith([15]);
      expect(deviceContext.acc.objects).toEqual([chosenObject]);

      // cancel 应撤销已选中的对象
      tool.process({ signals: [{ type: "cancel" }] }, deviceContext);

      expect(boardApi.discardActiveObjects).toHaveBeenCalledWith([15]);
      expect(deviceContext.acc.objects).toBeUndefined();
      // nodeState 中 objects 应被清理
      expect(stateAccess.getState()).toEqual({});
    });
  });
});
