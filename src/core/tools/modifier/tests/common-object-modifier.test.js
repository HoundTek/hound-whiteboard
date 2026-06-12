import { jest } from "@jest/globals";
import { Vector } from "../../../utils/math.js";
import { RectangleRange } from "../../../range/rectangle.js";
import { CommonObjectModifierTool } from "../common-object-modifier.js";
import { OBJECT_MODIFIER_SIGNAL_TYPES } from "../obj-modifier.js";

describe("CommonObjectModifierTool（手势驱动，保持光标偏移）", () => {
  test("首个 position 应启动手势（对象暂不动），第二个 position 才应用位移", () => {
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

    // 首个 position (15, 23)：锚点 = 光标位置，dx=0 → 对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 15, y: 23 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(10, 20));

    // 第二个 position (17, 23)：dx = 17-15 = 2, dy = 23-23 = 0 → (12, 20)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 17, y: 23 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(12, 20));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(2);
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledTimes(2);
  });

  test("后续 position 信号应继续以锚点为基准计算位移", () => {
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

    // 首个 position (15, 23) → 启动，对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 15, y: 23 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(10, 20));

    // 第二个 position (17, 23) → dx=2, dy=0 → (12, 20)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 17, y: 23 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(12, 20));

    // 第三个 position (22, 28) → dx=22-15=7, dy=28-23=5 → (17, 25)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 22, y: 28 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(17, 25));
  });

  test("end 信号结束手势后新一轮手势应有新锚点", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const tool = new CommonObjectModifierTool();

    // 第一轮手势
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 12, y: 20 } } }],
      },
      { acc: { objects: [object] } },
    );
    // 锚点=(12,20)，dx=0 → (10, 20)
    expect(object.position).toEqual(new Vector(10, 20));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 16, y: 22 } } }],
      },
      { acc: { objects: [object] } },
    );
    // dx=16-12=4, dy=22-20=2 → (14, 22)
    expect(object.position).toEqual(new Vector(14, 22));

    // end 信号
    tool.process(
      { signals: [{ type: "end" }] },
      { acc: { objects: [object] } },
    );
    expect(object.position).toEqual(new Vector(14, 22));

    // end 后新一轮手势：锚点从新光标位置开始
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 20, y: 22 } } }],
      },
      { acc: { objects: [object] } },
    );
    // 新锚点=(20,22)，新的 initPos={(14,22)}，dx=0 → (14, 22)
    expect(object.position).toEqual(new Vector(14, 22));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 25, y: 22 } } }],
      },
      { acc: { objects: [object] } },
    );
    // dx=25-20=5, dy=0 → (19, 22)
    expect(object.position).toEqual(new Vector(19, 22));
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

    // 首个 position → 启动手势，对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 7, y: 5 } } }],
      },
      {
        acc: { objects: [object], board },
        dag: mockDag,
        path: "/monitor/mouse/primary/tool/tool",
      },
    );
    expect(object.position).toEqual(new Vector(5, 5));

    // 第二个 position → 应用位移
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 10, y: 6 } } }],
      },
      {
        acc: { objects: [object], board },
        dag: mockDag,
        path: "/monitor/mouse/primary/tool/tool",
      },
    );
    // dx=10-7=3, dy=6-5=1 → (8, 6)
    expect(object.position).toEqual(new Vector(8, 6));

    const result = tool.process(
      {
        signals: [{ type: OBJECT_MODIFIER_SIGNAL_TYPES.SUCCESS, context: {} }],
      },
      {
        acc: { objects: [object], board },
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
    // 对象位置保留在最后修改状态
    expect(object.position).toEqual(new Vector(8, 6));
    expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
      new Set([object]),
    );
    expect(mockDag.unmount).toHaveBeenCalledWith(
      "/monitor/mouse/primary/tool/tool",
    );
    expect(nodeState.objects).toBeUndefined();
  });

  test("不传 position 信号时应保持原状态", () => {
    const object = {
      id: 1,
      position: new Vector(5, 5),
    };

    const tool = new CommonObjectModifierTool();
    tool.process({ signals: [] }, { acc: { objects: [object], monitor: {} } });

    expect(object.position).toEqual(new Vector(5, 5));
  });

  test("首个 position 在合矩形内应启动手势（对象暂不动），后续才应用位移", () => {
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

    // 首个 position (35, 35) 在 world rect (10..60, 20..50) 内 → 启动手势
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 35, y: 35 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    // 锚点=(35,35)，initPos=(10,20)，dx=0 → 对象不动
    expect(object.position).toEqual(new Vector(10, 20));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledTimes(1);

    // 第二个 position (40, 40) → dx=5, dy=5 → (15, 25)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 40, y: 40 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(15, 25));
  });

  test("首个 position 不在合矩形内时应拒绝手势", () => {
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
    // position (100, 200) 远在合矩形外
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
      },
      { acc: { objects: [object], monitor } },
    );

    expect(object.position).toEqual(new Vector(10, 20));
    expect(monitor.liveRenderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(monitor.liveRenderer.invalidateObjects).not.toHaveBeenCalled();
  });

  test("多对象合矩形准入检测：应在所有对象合矩形内通过后方可启动", () => {
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
    // 合矩形: left=10, top=20, right=110, bottom=100

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // 首个 position (80, 50) 在合矩形内 → 准入通过，锚点=(80,50)，对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 80, y: 50 } } }],
      },
      { acc: { objects: [objectA, objectB], monitor } },
    );
    expect(objectA.position).toEqual(new Vector(10, 20));
    expect(objectB.position).toEqual(new Vector(70, 80));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);

    // 第二个 position (90, 60) → dx=10, dy=10
    // objectA: (20, 30), objectB: (80, 90)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 90, y: 60 } } }],
      },
      { acc: { objects: [objectA, objectB], monitor } },
    );
    expect(objectA.position).toEqual(new Vector(20, 30));
    expect(objectB.position).toEqual(new Vector(80, 90));
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

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // position (5, 5) 在合矩形外
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 5, y: 5 } } }],
      },
      { acc: { objects: [objectA, objectB], monitor } },
    );

    expect(objectA.position).toEqual(new Vector(10, 20));
    expect(objectB.position).toEqual(new Vector(70, 80));
    expect(monitor.liveRenderer.captureObjectSnapshot).not.toHaveBeenCalled();
  });

  test("对象无 getRange 时跳过准入检测（兼容旧版对象）", () => {
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

    // combinedRect 为 null → 跳过检测，锚点=(100,200)，对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(10, 20));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);

    // 第二个 position → dx=110-100=10, dy=210-200=10 → (20, 30)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 110, y: 210 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(20, 30));
  });

  test("reset 应清空手势状态，新一轮手势从新光标位置开始", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const tool = new CommonObjectModifierTool();

    // 第一轮手势
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 12, y: 20 } } }],
      },
      { acc: { objects: [object] } },
    );
    // 锚点=(12,20)，dx=0 → (10, 20)
    expect(object.position).toEqual(new Vector(10, 20));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 16, y: 20 } } }],
      },
      { acc: { objects: [object] } },
    );
    // dx=16-12=4, dy=0 → (14, 20)
    expect(object.position).toEqual(new Vector(14, 20));

    tool.reset();

    // reset 后新一轮手势：锚点从新光标 (17, 20) 开始
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 17, y: 20 } } }],
      },
      { acc: { objects: [object] } },
    );
    // 新锚点=(17,20)，新 initPos(14,20)，dx=0 → (14,20)
    expect(object.position).toEqual(new Vector(14, 20));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 20, y: 20 } } }],
      },
      { acc: { objects: [object] } },
    );
    // dx=20-17=3, dy=0 → (17, 20)
    expect(object.position).toEqual(new Vector(17, 20));
  });

  test("同一信号包中 position + end：应启动并立即结束手势，且不触发多余的快照", () => {
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

    // 同一信号包中包含 position + end
    tool.process(
      {
        signals: [
          { type: "position", context: { value: { x: 15, y: 23 } } },
          { type: "end" },
        ],
      },
      { acc: { objects: [object], monitor } },
    );

    // 手势启动后立即结束，对象未移动
    expect(object.position).toEqual(new Vector(10, 20));
    // begin+update 触发一次 withGeometryMutation
    // end 不包裹 withGeometryMutation（completeModifyGesture 仅做状态清理）
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledTimes(1);

    // 新一轮手势应以新锚点正常启动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 20, y: 25 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    expect(object.position).toEqual(new Vector(10, 20)); // 新锚点=(20,25)，dx=0

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 25, y: 30 } } }],
      },
      { acc: { objects: [object], monitor } },
    );
    // dx=25-20=5, dy=30-25=5 → (15, 25)
    expect(object.position).toEqual(new Vector(15, 25));
  });

  describe("手势准入检测——边缘场景", () => {
    function makeDeviceContext(opts = {}) {
      const { objects, board, monitor } = opts;
      return {
        acc: {
          ...(objects ? { objects } : {}),
          ...(board ? { board } : {}),
          ...(monitor ? { monitor } : {}),
        },
      };
    }

    test("position 恰好在合矩形边界上应通过准入检测", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
        getRange: () => new RectangleRange(0, 0, 50, 30),
      };
      // world rect: (10, 20, 50, 30) → left=10, top=20, right=60, bottom=50

      const monitor = {
        liveRenderer: {
          captureObjectSnapshot: jest.fn(),
          invalidateObjects: jest.fn(),
        },
      };

      const tool = new CommonObjectModifierTool();

      // 左上角边界 (10, 20) → 锚点=(10,20)，dx=0 → 对象不动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 10, y: 20 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      expect(object.position).toEqual(new Vector(10, 20));
      // 第二个 position → 确认手势确实激活并能移动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 15, y: 25 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // dx=5, dy=5 → (15, 25)
      expect(object.position).toEqual(new Vector(15, 25));
      tool.reset();

      // 右下角边界 (60, 50) → 锚点=(60,50)，initPos=(15,25)，dx=0
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 60, y: 50 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      expect(object.position).toEqual(new Vector(15, 25));
      // containsPoint 使用 1e-8 容差，边界点应命中
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 65, y: 55 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // dx=5, dy=5 → (20, 30)
      expect(object.position).toEqual(new Vector(20, 30));
    });

    test("准入检测拒绝后新一轮 position 可以重新启动手势", () => {
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

      // 第一次：position (100, 200) 在外部 → 拒绝
      tool.process(
        {
          signals: [
            { type: "position", context: { value: { x: 100, y: 200 } } },
          ],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      expect(object.position).toEqual(new Vector(10, 20));
      expect(monitor.liveRenderer.captureObjectSnapshot).not.toHaveBeenCalled();

      // 第二次：position (30, 35) 在内部 → 新锚点，正常启动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 30, y: 35 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // 锚点=(30,35)，dx=0 → (10, 20)
      expect(object.position).toEqual(new Vector(10, 20));
      expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(
        1,
      );

      // 第三个 position → 确认位移生效
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 35, y: 40 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // dx=5, dy=5 → (15, 25)
      expect(object.position).toEqual(new Vector(15, 25));
    });

    test("准入检测只发生在手势开始时，手势激活后不再检测", () => {
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

      // 首个 position (30, 35)：在内部，启动手势，对象不动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 30, y: 35 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // 锚点=(30,35)，dx=0 → (10, 20)
      expect(object.position).toEqual(new Vector(10, 20));

      // 第二个 position (100, 200)：在合矩形外，但手势已激活不检测准入
      tool.process(
        {
          signals: [
            { type: "position", context: { value: { x: 100, y: 200 } } },
          ],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // 锚点仍为(30,35)，dx=70, dy=165 → (80, 185)
      expect(object.position).toEqual(new Vector(80, 185));
      // withGeometryMutation 每次 position 都会执行快照→变更→失效协议
      expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(
        2,
      );
    });

    test("经过 AOM 过滤后对象集合为空时不应触发手势", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map(),
        },
      };

      const tool = new CommonObjectModifierTool();
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 15, y: 23 } } }],
        },
        makeDeviceContext({ objects: [object], board }),
      );

      expect(object.position).toEqual(new Vector(10, 20));
    });

    test("end 信号后新一轮手势应重新执行准入检测", () => {
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

      // 第一轮：启动并移动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 30, y: 35 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // 锚点=(30,35)，dx=0 → (10, 20)
      expect(object.position).toEqual(new Vector(10, 20));

      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 35, y: 40 } } }],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // dx=5, dy=5 → (15, 25)
      expect(object.position).toEqual(new Vector(15, 25));

      // end 结束手势
      tool.process(
        { signals: [{ type: "end" }] },
        makeDeviceContext({ objects: [object], monitor }),
      );

      // 新一轮：position (100, 200) 在外部 → 应拒绝
      tool.process(
        {
          signals: [
            { type: "position", context: { value: { x: 100, y: 200 } } },
          ],
        },
        makeDeviceContext({ objects: [object], monitor }),
      );
      // 准入拒绝，对象位置保持在 end 时刻
      expect(object.position).toEqual(new Vector(15, 25));
      expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledTimes(
        2,
      );
    });
  });
});
