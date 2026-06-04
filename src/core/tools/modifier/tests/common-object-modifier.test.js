import { jest } from "@jest/globals";
import { Vector } from "../../../utils/math.js";
import { RectangleRange } from "../../../range/rectangle.js";
import { CommonObjectModifierTool } from "../common-object-modifier.js";
import { OBJECT_MODIFIER_SIGNAL_TYPES } from "../obj-modifier.js";

describe("CommonObjectModifierTool（手势驱动）", () => {
  test("首个 displacement 信号应启动手势并应用位移", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 5, y: 3 } } }],
      },
      { object, monitor },
    );

    // 首个 displacement：记录初始位置，应用位移 initPos + (5, 3)
    expect(object.position).toEqual(new Vector(15, 23));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledTimes(1);
  });

  test("后续 displacement 信号应直接以累计位移更新对象", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // 首个 displacement —— 手势开始，位移 (5, 3)
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 5, y: 3 } } }],
      },
      { object, monitor },
    );
    expect(object.position).toEqual(new Vector(15, 23));

    // 第二个 displacement —— 累计位移 (7, 3)，直接从 initPos 计算
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 7, y: 3 } } }],
      },
      { object, monitor },
    );
    expect(object.position).toEqual(new Vector(17, 23));
  });

  test("end 信号应结束手势，对象保持在当前位置", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const tool = new CommonObjectModifierTool();

    // 手势开始并移动
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 2, y: 0 } } }],
      },
      { object },
    );
    expect(object.position).toEqual(new Vector(12, 20));
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 5, y: 1 } } }],
      },
      { object },
    );
    expect(object.position).toEqual(new Vector(15, 21));

    // end 信号
    tool.process({ signals: [{ type: "end" }] }, { object });
    expect(object.position).toEqual(new Vector(15, 21));

    // end 后新一轮手势
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 1, y: 0 } } }],
      },
      { object },
    );
    // 新锚点：从当前 (15, 21) 启动，位移 (1, 0) → (16, 21)
    expect(object.position).toEqual(new Vector(16, 21));
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 5, y: 0 } } }],
      },
      { object },
    );
    // 累计位移 (5, 0)：(15, 21) + (5, 0) = (20, 21)
    expect(object.position).toEqual(new Vector(20, 21));
  });

  test("success 信号应将对象提交到静态图并卸载", () => {
    const object = {
      id: 7,
      position: new Vector(5, 5),
    };

    const board = {
      activeObjectManager: {
        activeObjectIndex: new Map([[object.id, object]]),
        apply: jest.fn(),
      },
    };
    const mockDag = {
      unmount: jest.fn(),
    };
    let nodeState = { object };
    const tool = new CommonObjectModifierTool();

    // 手势移动
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 2, y: 0 } } }],
      },
      {
        object,
        board,
        dag: mockDag,
        path: "/monitor/mouse/primary/tool/tool",
      },
    );
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 5, y: 1 } } }],
      },
      {
        object,
        board,
        dag: mockDag,
        path: "/monitor/mouse/primary/tool/tool",
      },
    );

    // success 信号
    const result = tool.process(
      {
        signals: [{ type: OBJECT_MODIFIER_SIGNAL_TYPES.SUCCESS, context: {} }],
      },
      {
        object,
        board,
        dag: mockDag,
        path: "/monitor/mouse/primary/tool/tool",
        getNodeState() {
          return nodeState;
        },
        setNodeState(path, nextState) {
          nodeState = nextState ?? {};
          return nodeState;
        },
      },
    );

    expect(result).toBeUndefined();
    expect(object.position).toEqual(new Vector(10, 6));
    expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
      new Set([object]),
    );
    expect(mockDag.unmount).toHaveBeenCalledWith(
      "/monitor/mouse/primary/tool/tool",
    );
    expect(nodeState.object).toBeUndefined();
  });

  test("不传 displacement 信号时应保持原状态且不报错", () => {
    const object = {
      id: 1,
      position: new Vector(5, 5),
    };

    const tool = new CommonObjectModifierTool();
    tool.process({ signals: [] }, { object, monitor: {} });

    expect(object.position).toEqual(new Vector(5, 5));
  });

  test("首个 displacement 的 position 在合矩形内时应启动手势", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
      getRange: () => new RectangleRange(0, 0, 50, 30),
    };

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();
    // position (35, 35) 在 world rect (10, 20, 50, 30) = (10..60, 20..50) 内
    tool.process(
      {
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 5, y: 3 },
              position: { x: 35, y: 35 },
            },
          },
        ],
      },
      { object, monitor },
    );

    // 准入通过，手势应启动并应用位移
    expect(object.position).toEqual(new Vector(15, 23));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
  });

  test("首个 displacement 的 position 不在合矩形内时应拒绝手势", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
      getRange: () => new RectangleRange(0, 0, 50, 30),
    };

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();
    // position (100, 200) 远在 world rect (10, 20, 50, 30) 之外
    tool.process(
      {
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 5, y: 3 },
              position: { x: 100, y: 200 },
            },
          },
        ],
      },
      { object, monitor },
    );

    // 准入拒绝，对象位置不变，无快照无失效
    expect(object.position).toEqual(new Vector(10, 20));
    expect(
      monitor.liveRenderer.captureObjectSnapshot,
    ).not.toHaveBeenCalled();
    expect(monitor.liveRenderer.invalidateObjects).not.toHaveBeenCalled();
  });

  test("首个 displacement 无 position 上下文时跳过准入检测（向后兼容）", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
      getRange: () => new RectangleRange(0, 0, 50, 30),
    };

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();
    // 不含 position → 跳过准入检测，正常启动手势
    tool.process(
      {
        signals: [
          { type: "displacement", context: { value: { x: 5, y: 3 } } },
        ],
      },
      { object, monitor },
    );

    expect(object.position).toEqual(new Vector(15, 23));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
  });

  test("多对象合矩形准入检测：position 应在所有对象合矩形内", () => {
    const objectA = {
      id: 1,
      position: new Vector(10, 20),
      getRange: () => new RectangleRange(0, 0, 50, 30),
    };
    const objectB = {
      id: 2,
      position: new Vector(70, 80),
      getRange: () => new RectangleRange(0, 0, 40, 20),
    };
    // 合矩形 world rect: left=10, top=20, right=110, bottom=100

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // position (80, 50) 在合矩形内
    tool.process(
      {
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 0, y: 0 },
              position: { x: 80, y: 50 },
            },
          },
        ],
      },
      { objects: [objectA, objectB], monitor },
    );

    expect(objectA.position).toEqual(new Vector(10, 20));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
  });

  test("多对象合矩形准入检测：position 在合矩形外应拒绝", () => {
    const objectA = {
      id: 1,
      position: new Vector(10, 20),
      getRange: () => new RectangleRange(0, 0, 50, 30),
    };
    const objectB = {
      id: 2,
      position: new Vector(70, 80),
      getRange: () => new RectangleRange(0, 0, 40, 20),
    };
    // 合矩形 world rect: left=10, top=20, right=110, bottom=100

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // position (5, 5) 在合矩形之外（left=10, top=20 的左上方）
    tool.process(
      {
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 0, y: 0 },
              position: { x: 5, y: 5 },
            },
          },
        ],
      },
      { objects: [objectA, objectB], monitor },
    );

    // 准入拒绝，对象不变
    expect(objectA.position).toEqual(new Vector(10, 20));
    expect(objectB.position).toEqual(new Vector(70, 80));
    expect(
      monitor.liveRenderer.captureObjectSnapshot,
    ).not.toHaveBeenCalled();
  });

  test("对象无 getRange 时跳过准入检测（兼容旧版对象）", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
      // 没有 getRange
    };

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();
    tool.process(
      {
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 5, y: 3 },
              position: { x: 100, y: 200 },
            },
          },
        ],
      },
      { object, monitor },
    );

    // combinedRect 为 null → 跳过检测，正常启动手势
    expect(object.position).toEqual(new Vector(15, 23));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
  });

  test("reset 应清空手势状态", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const tool = new CommonObjectModifierTool();

    // 第一轮手势
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 2, y: 0 } } }],
      },
      { object },
    );
    expect(object.position).toEqual(new Vector(12, 20));
    tool.reset();

    // reset 后新一轮手势：从当前位置开始
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 5, y: 0 } } }],
      },
      { object },
    );
    expect(object.position).toEqual(new Vector(17, 20));
    tool.process(
      {
        signals: [{ type: "displacement", context: { value: { x: 8, y: 0 } } }],
      },
      { object },
    );
    expect(object.position).toEqual(new Vector(20, 20));
  });
});
