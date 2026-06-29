import { jest } from "@jest/globals";
import { ObjectChooserTool } from "../object-chooser.js";
import { RectangleObjectChooserTool } from "../rectangle-object-chooser.js";
import { RectangleRange } from "../../../range/index.js";
import { Vector } from "../../../utils/math.js";
import { createStateAccess } from "../../../test-support/state-fixtures.js";

describe("ObjectChooserTool", () => {
  class TestChooserTool extends ObjectChooserTool {
    constructor(options = {}) {
      super(options);
      this.chosenObjects = options.chosenObjects ?? [];
    }

    choose() {
      return this.chosenObjects;
    }

    reset() {}
  }

  test("process 应将选择结果加入 AOM 并写回上下文", () => {
    const chosenObject = { id: 1 };
    const board = {
      activeObjectManager: {
        choose: jest.fn(),
      },
    };
    const stateAccess = createStateAccess();
    const deviceContext = {
      acc: { board },
      path: "/monitor/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };
    const tool = new TestChooserTool({ chosenObjects: [chosenObject] });

    tool.process(
      { signals: [{ type: "trigger", context: {} }] },
      deviceContext,
    );

    expect(board.activeObjectManager.choose).toHaveBeenCalledWith(
      new Set([chosenObject]),
    );
    expect(deviceContext.acc.objects).toEqual([chosenObject]);
    expect(stateAccess.getState()).toEqual({
      objects: [chosenObject],
    });
  });

  test("umount 应撤销当前选择并清理上下文", () => {
    const chosenObject = { id: 4 };
    const board = {
      activeObjectManager: {
        discard: jest.fn(),
      },
    };
    const tool = new TestChooserTool();
    const stateAccess = createStateAccess({
      objects: [chosenObject],
    });
    const deviceContext = {
      acc: { board, objects: [chosenObject] },
      path: "/monitor/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.umount(deviceContext);

    expect(board.activeObjectManager.discard).toHaveBeenCalledWith(
      new Set([chosenObject]),
    );
    expect(deviceContext.acc.objects).toBeUndefined();
    expect(stateAccess.getState()).toEqual({});
  });

  test("显式提供 boardApi 时 process 应走 addActiveObjects 并将真实对象实例写回上下文", () => {
    const liveObject = { id: 31, live: true };
    const boardApi = {
      addActiveObjects: jest.fn(),
      getBoardCore: () => ({
        getObjectById: (objectId) => (objectId === 31 ? liveObject : undefined),
      }),
    };
    const stateAccess = createStateAccess();
    const deviceContext = {
      acc: { boardApi },
      path: "/monitor/chooser/tool",
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
      { signals: [{ type: "trigger", context: {} }] },
      deviceContext,
    );

    expect(boardApi.addActiveObjects).toHaveBeenCalledWith([31]);
    expect(deviceContext.acc.objects).toEqual([liveObject]);
    expect(stateAccess.getState()).toEqual({ objects: [liveObject] });
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
      path: "/monitor/chooser/tool",
      getNodeState: stateAccess.getState,
      setNodeState: stateAccess.setState,
    };

    tool.umount(deviceContext);

    expect(discardActiveObjects).toHaveBeenCalledWith([41]);
    expect(deviceContext.acc.objects).toBeUndefined();
    expect(stateAccess.getState()).toEqual({});
  });

  test("collectUiOverlayEntries 在子 modifier 已有对象时不应重复声明 chooser 选择框", () => {
    const chosenObject = { id: 5 };
    const tool = new TestChooserTool();
    const renderer = {
      createCompatSelectionEntriesForSummaries: jest.fn(() => [
        "chooser-overlay",
      ]),
    };

    const suppressed = tool.collectUiOverlayEntries({
      deviceContext: {
        acc: { objects: [chosenObject] },
        path: "/monitor/chooser/tool",
        dag: {
          resolveDefaultLeaf: () => ({
            path: "/monitor/chooser/tool/tool",
            state: { objects: [chosenObject] },
          }),
        },
      },
      renderer,
    });

    expect(suppressed).toEqual([]);

    const visible = tool.collectUiOverlayEntries({
      deviceContext: {
        acc: { objects: [chosenObject] },
        path: "/monitor/chooser/tool",
        dag: {
          resolveDefaultLeaf: () => ({
            path: "/monitor/chooser/tool",
            state: {},
          }),
        },
      },
      renderer,
    });

    expect(visible).toEqual(["chooser-overlay"]);
    expect(
      renderer.createCompatSelectionEntriesForSummaries,
    ).toHaveBeenCalledWith([chosenObject], "chooser");
  });

  test("collectUiOverlayEntries 在 summary-like 条目时应走 summaries 入口", () => {
    const chosenObject = {
      id: 51,
      position: { x: 10, y: 20 },
      range: new RectangleRange(0, 0, 5, 5),
    };
    const tool = new TestChooserTool();
    const renderer = {
      createCompatSelectionEntriesForSummaries: jest.fn(() => [
        "chooser-summary-overlay",
      ]),
    };

    const visible = tool.collectUiOverlayEntries({
      deviceContext: {
        acc: { objects: [chosenObject] },
        path: "/monitor/chooser/tool",
        dag: {
          resolveDefaultLeaf: () => ({
            path: "/monitor/chooser/tool",
            state: {},
          }),
        },
      },
      renderer,
    });

    expect(visible).toEqual(["chooser-summary-overlay"]);
    expect(
      renderer.createCompatSelectionEntriesForSummaries,
    ).toHaveBeenCalledWith([chosenObject], "chooser");
  });

  test("resolveObjectSelectionWorldRange 应使用对象主判定范围而不是 boundingBox", () => {
    const tool = new TestChooserTool();
    const objectEntry = {
      id: 6,
      position: new Vector(100, 200),
      boundingBox: new RectangleRange(0, 0, 40, 50),
      getRange() {
        return new RectangleRange(10, 20, 5, 6);
      },
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
      const board = {
        activeObjectManager: { choose: jest.fn() },
      };
      const stateAccess = createStateAccess();
      const deviceContext = {
        acc: { board },
        path: "/test",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
      };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      const afterChoose = jest.fn();
      tool.on("afterChoose", afterChoose);

      tool.process({ signals: [{ type: "trigger" }] }, deviceContext);

      expect(afterChoose).toHaveBeenCalledTimes(1);
      expect(afterChoose).toHaveBeenCalledWith([chosenObject]);
    });

    test("afterChoose 在无选中对象时不触发", () => {
      const board = {
        activeObjectManager: { choose: jest.fn() },
      };
      const tool = new TestChooserTool({ chosenObjects: [] });
      const afterChoose = jest.fn();
      tool.on("afterChoose", afterChoose);

      tool.process(
        { signals: [{ type: "trigger" }] },
        {
          acc: { board },
          path: "/test",
          getNodeState: () => ({}),
          setNodeState: () => {},
        },
      );

      expect(afterChoose).not.toHaveBeenCalled();
    });

    test("confirmSelection → beforeConfirm 返回 false 时阻止 afterConfirm", () => {
      const chosenObject = { id: 11 };
      const board = {
        activeObjectManager: { choose: jest.fn() },
      };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      const afterConfirm = jest.fn();
      tool.on("afterConfirm", afterConfirm);
      tool.beforeConfirmSelection = () => false;

      const result = tool.confirmSelection({ acc: { board }, path: "/test" }, [
        chosenObject,
      ]);

      expect(result).toBe(false);
      expect(afterConfirm).not.toHaveBeenCalled();
    });

    test("confirmSelection 默认触发 afterConfirm", () => {
      const chosenObject = { id: 12 };
      const tool = new TestChooserTool({ chosenObjects: [chosenObject] });
      const afterConfirm = jest.fn();
      tool.on("afterConfirm", afterConfirm);

      const result = tool.confirmSelection(
        { acc: { board: {} }, path: "/test" },
        [chosenObject],
      );

      expect(result).toBe(true);
      expect(afterConfirm).toHaveBeenCalledTimes(1);
      expect(afterConfirm).toHaveBeenCalledWith(
        { acc: { board: {} }, path: "/test" },
        [chosenObject],
      );
    });

    test("RectangleObjectChooserTool 在 end 信号时调用 confirmSelection", () => {
      // 准备一个虚拟对象用于框选命中
      const objectInBoard = {
        id: 20,
        position: new Vector(50, 50),
        getRange() {
          return new RectangleRange(0, 0, 10, 10);
        },
      };
      const board = {
        objectLoaded: new Map([["chunk-1", { obj: objectInBoard }]]),
        activeObjectManager: {
          activeObjectIndex: new Map(),
          choose: jest.fn(),
          discard: jest.fn(),
        },
      };
      const stateAccess = createStateAccess();
      const deviceContext = {
        acc: { board },
        path: "/monitor/chooser",
        getNodeState: stateAccess.getState,
        setNodeState: stateAccess.setState,
      };

      const tool = new RectangleObjectChooserTool();
      const afterConfirm = jest.fn();
      const afterChoose = jest.fn();
      tool.on("afterConfirm", afterConfirm);
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

      // afterChoose 触发（setContextObjects 后）
      expect(afterChoose).toHaveBeenCalledTimes(1);
      // afterConfirm 触发（confirmSelection 后）
      expect(afterConfirm).toHaveBeenCalledTimes(1);

      const confirmCall = afterConfirm.mock.calls[0];
      expect(confirmCall[0]).toMatchObject({ path: "/monitor/chooser" });
      expect(confirmCall[1]).toEqual([objectInBoard]);
    });
  });
});
