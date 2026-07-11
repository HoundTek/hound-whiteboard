import { jest } from "@jest/globals";
import { Vector } from "../../../../../utils/math.js";
import { RectangleRange } from "../../../../../shared/range/rectangle.js";
import { CommonObjectModifierTool } from "../common-object-modifier.js";
import { OBJECT_MODIFIER_SIGNAL_TYPES } from "../object-modifier.js";

/**
 * 构造包含 AOM 的测试上下文
 * 新代码中 resolveActiveModifiedObjects 在没有 activeObjectIndex 时返回空，
 * 因此测试必须提供模拟的 AOM 上下文。
 * @param {Array|Object} objects - 测试对象（或对象数组）
 * @param {Object} [extra={}] - 额外的 acc 属性（如 viewport）
 * @returns {{ acc: Object }} 可用于 tool.process 的 DAG 上下文
 */
function aomCtx(objects, extra = {}) {
  const normalized = Array.isArray(objects) ? objects : [objects];
  return {
    acc: {
      objects: normalized.filter(Boolean),
      board: {
        activeObjectManager: {
          activeObjectIndex: new Map(
            normalized.filter((o) => o && o.id != null).map((o) => [o.id, o]),
          ),
        },
      },
      ...extra,
    },
  };
}

describe("CommonObjectModifierTool", () => {
  test("首个 position 应启动手势，对象不动，第二个 position 才应用位移", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // 首个 position (15, 23)：锚点 = 光标位置，dx=0 → 对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 15, y: 23 } } }],
      },
      aomCtx(object, { viewport }),
    );
    expect(object.position).toEqual(new Vector(10, 20));

    // 第二个 position (17, 23)：dx = 17-15 = 2, dy = 23-23 = 0 → (12, 20)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 17, y: 23 } } }],
      },
      aomCtx(object, { viewport }),
    );
    expect(object.position).toEqual(new Vector(12, 20));
    // 首次 position 抓快照，后续 position 不抓
    expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
    expect(viewport.renderer.invalidateActiveObjects).toHaveBeenCalledTimes(2);
  });

  test("后续 position 信号应继续以锚点为基准计算位移", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // 首个 position (15, 23) → 启动，对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 15, y: 23 } } }],
      },
      aomCtx(object, { viewport }),
    );
    expect(object.position).toEqual(new Vector(10, 20));

    // 第二个 position (17, 23) → dx=2, dy=0 → (12, 20)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 17, y: 23 } } }],
      },
      aomCtx(object, { viewport }),
    );
    expect(object.position).toEqual(new Vector(12, 20));

    // 第三个 position (22, 28) → dx=22-15=7, dy=28-23=5 → (17, 25)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 22, y: 28 } } }],
      },
      aomCtx(object, { viewport }),
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
      aomCtx(object),
    );
    // 锚点=(12,20)，dx=0 → (10, 20)
    expect(object.position).toEqual(new Vector(10, 20));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 16, y: 22 } } }],
      },
      aomCtx(object),
    );
    // dx=16-12=4, dy=22-20=2 → (14, 22)
    expect(object.position).toEqual(new Vector(14, 22));

    // end 信号
    tool.process({ signals: [{ type: "end" }] }, aomCtx(object));
    expect(object.position).toEqual(new Vector(14, 22));

    // end 后新一轮手势：锚点从新光标位置开始
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 20, y: 22 } } }],
      },
      aomCtx(object),
    );
    // 新锚点=(20,22)，新的 initPos={(14,22)}，dx=0 → (14, 22)
    expect(object.position).toEqual(new Vector(14, 22));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 25, y: 22 } } }],
      },
      aomCtx(object),
    );
    // dx=25-20=5, dy=0 → (19, 22)
    expect(object.position).toEqual(new Vector(19, 22));
  });

  test("success 信号应通过 commitObjects 提交对象并卸载", () => {
    const object = {
      id: 7,
      position: new Vector(5, 5),
    };

    const boardApi = {
      modifyObject: jest.fn(),
      commitObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const mockDag = {
      unmount: jest.fn(),
    };
    let nodeState = { object };
    const tool = new CommonObjectModifierTool();

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 7, y: 5 } } }],
      },
      {
        acc: { objects: [object], boardApi },
        dag: mockDag,
        path: "/viewport/mouse/primary/tool/tool",
      },
    );
    expect(object.position).toEqual(new Vector(5, 5));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 10, y: 6 } } }],
      },
      {
        acc: { objects: [object], boardApi },
        dag: mockDag,
        path: "/viewport/mouse/primary/tool/tool",
      },
    );
    expect(object.position).toEqual(new Vector(8, 6));

    const result = tool.process(
      {
        signals: [{ type: OBJECT_MODIFIER_SIGNAL_TYPES.SUCCESS, context: {} }],
      },
      {
        acc: { objects: [object], boardApi },
        dag: mockDag,
        path: "/viewport/mouse/primary/tool/tool",
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
    expect(object.position).toEqual(new Vector(8, 6));
    expect(boardApi.commitObjects).toHaveBeenCalledWith([7]);
    expect(mockDag.unmount).toHaveBeenCalledWith(
      "/viewport/mouse/primary/tool/tool",
    );
    expect(nodeState.objects).toBeUndefined();
  });

  test("显式提供 boardApi 时应通过 modifyObject 更新位置并在 success 后提交", () => {
    const tool = new CommonObjectModifierTool();
    const object = {
      id: 501,
      position: new Vector(10, 20),
      data: { radius: 5 },
    };
    const boardApi = {
      modifyObject: jest.fn(),
      commitObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const modifySpy = boardApi.modifyObject;
    const commitSpy = boardApi.commitObjects;
    const mockDag = { unmount: jest.fn() };
    const viewport = { requestViewportUiRender: jest.fn() };
    let nodeState = {};
    const context = {
      acc: { boardApi, viewport, objects: [object] },
      dag: mockDag,
      path: "/viewport/mouse/primary/tool/tool",
      getNodeState() {
        return nodeState;
      },
      setNodeState(path, nextState) {
        nodeState = nextState ?? {};
        return nodeState;
      },
    };

    expect(object.position).toEqual(new Vector(10, 20));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 10, y: 20 } } }],
      },
      context,
    );
    expect(object.position).toEqual(new Vector(10, 20));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 13, y: 24 } } }],
      },
      context,
    );
    expect(object.position).toEqual(new Vector(13, 24));
    expect(modifySpy).toHaveBeenCalledWith(501, {
      position: { x: 13, y: 24 },
    });

    tool.process(
      {
        signals: [{ type: OBJECT_MODIFIER_SIGNAL_TYPES.SUCCESS, context: {} }],
      },
      context,
    );

    expect(commitSpy).toHaveBeenCalledWith([501]);
    expect(mockDag.unmount).toHaveBeenCalledWith(
      "/viewport/mouse/primary/tool/tool",
    );
    expect(nodeState.objects).toBeUndefined();
    expect(viewport.requestViewportUiRender).toHaveBeenCalled();
  });

  test("显式提供 boardApi 时应支持 summary-like 上下文对象完成准入与位移", () => {
    const tool = new CommonObjectModifierTool();
    const boardApi = {
      modifyObject: jest.fn(),
      commitObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const summaryLikeObject = {
      id: 502,
      type: "CircleObject",
      position: { x: 30, y: 40 },
      range: new RectangleRange(-5, -5, 10, 10),
      boundingBox: new RectangleRange(-5, -5, 10, 10),
      property: {},
      data: { radius: 5 },
    };
    const context = {
      acc: {
        boardApi,
        viewport: { requestViewportUiRender: jest.fn() },
        objects: [summaryLikeObject],
      },
    };

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 30, y: 40 } } }],
      },
      context,
    );
    expect(summaryLikeObject.position).toEqual(new Vector(30, 40));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 34, y: 43 } } }],
      },
      context,
    );

    expect(summaryLikeObject.position).toEqual(new Vector(34, 43));
    expect(boardApi.modifyObject).toHaveBeenCalledWith(502, {
      position: { x: 34, y: 43 },
    });
  });

  test("显式提供 RPC boardApi 时不应读取本地 stale activeObjectIndex", () => {
    const tool = new CommonObjectModifierTool();
    const summaryLikeObject = {
      id: 503,
      type: "CircleObject",
      position: { x: 30, y: 40 },
      range: new RectangleRange(-5, -5, 10, 10),
      boundingBox: new RectangleRange(-5, -5, 10, 10),
      property: {},
      data: { radius: 5 },
    };
    const modifyObject = jest.fn();
    const context = {
      acc: {
        board: {
          activeObjectManager: {
            activeObjectIndex: new Map(),
          },
        },
        boardApi: {
          modifyObject,
          commitObjects: jest.fn(),
          discardActiveObjects: jest.fn(),
        },
        viewport: { requestViewportUiRender: jest.fn() },
        objects: [summaryLikeObject],
      },
    };

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 30, y: 40 } } }],
      },
      context,
    );
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 34, y: 43 } } }],
      },
      context,
    );

    expect(summaryLikeObject.position).toEqual(new Vector(34, 43));
    expect(modifyObject).toHaveBeenCalledWith(503, {
      position: { x: 34, y: 43 },
    });
  });

  test("不传 position 信号时应保持原状态", () => {
    const object = {
      id: 1,
      position: new Vector(5, 5),
    };

    const tool = new CommonObjectModifierTool();
    tool.process({ signals: [] }, aomCtx(object, { viewport: {} }));

    expect(object.position).toEqual(new Vector(5, 5));
  });

  test("首个 position 在合矩形内应启动手势（对象暂不动），后续才应用位移", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
      getRange: () => new RectangleRange(0, 0, 50, 30),
    };

    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // 首个 position (35, 35) 在 world rect (10..60, 20..50) 内 → 启动手势
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 35, y: 35 } } }],
      },
      aomCtx(object, { viewport }),
    );
    // 锚点=(35,35)，initPos=(10,20)，dx=0 → 对象不动
    expect(object.position).toEqual(new Vector(10, 20));
    expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
    expect(viewport.renderer.invalidateActiveObjects).toHaveBeenCalledTimes(1);

    // 第二个 position (40, 40) → dx=5, dy=5 → (15, 25)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 40, y: 40 } } }],
      },
      aomCtx(object, { viewport }),
    );
    expect(object.position).toEqual(new Vector(15, 25));
  });

  test("首个 position 不在合矩形内时应拒绝手势", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
      getRange: () => new RectangleRange(0, 0, 50, 30),
    };

    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();
    // position (100, 200) 远在合矩形外
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
      },
      aomCtx(object, { viewport }),
    );

    expect(object.position).toEqual(new Vector(10, 20));
    expect(viewport.renderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(viewport.renderer.invalidateActiveObjects).not.toHaveBeenCalled();
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

    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // 首个 position (80, 50) 在合矩形内 → 准入通过，锚点=(80,50)，对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 80, y: 50 } } }],
      },
      aomCtx([objectA, objectB], { viewport }),
    );
    expect(objectA.position).toEqual(new Vector(10, 20));
    expect(objectB.position).toEqual(new Vector(70, 80));
    expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);

    // 第二个 position (90, 60) → dx=10, dy=10
    // objectA: (20, 30), objectB: (80, 90)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 90, y: 60 } } }],
      },
      aomCtx([objectA, objectB], { viewport }),
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

    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // position (5, 5) 在合矩形外
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 5, y: 5 } } }],
      },
      aomCtx([objectA, objectB], { viewport }),
    );

    expect(objectA.position).toEqual(new Vector(10, 20));
    expect(objectB.position).toEqual(new Vector(70, 80));
    expect(viewport.renderer.captureObjectSnapshot).not.toHaveBeenCalled();
  });

  test("对象无 getRange 时跳过准入检测（兼容旧版对象）", () => {
    const object = {
      id: 1,
      position: new Vector(10, 20),
    };

    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();

    // combinedRect 为 null → 跳过检测，锚点=(100,200)，对象不动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
      },
      aomCtx(object, { viewport }),
    );
    expect(object.position).toEqual(new Vector(10, 20));
    expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);

    // 第二个 position → dx=110-100=10, dy=210-200=10 → (20, 30)
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 110, y: 210 } } }],
      },
      aomCtx(object, { viewport }),
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
      aomCtx(object),
    );
    // 锚点=(12,20)，dx=0 → (10, 20)
    expect(object.position).toEqual(new Vector(10, 20));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 16, y: 20 } } }],
      },
      aomCtx(object),
    );
    // dx=16-12=4, dy=0 → (14, 20)
    expect(object.position).toEqual(new Vector(14, 20));

    tool.reset();

    // reset 后新一轮手势：锚点从新光标 (17, 20) 开始
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 17, y: 20 } } }],
      },
      aomCtx(object),
    );
    // 新锚点=(17,20)，新 initPos(14,20)，dx=0 → (14,20)
    expect(object.position).toEqual(new Vector(14, 20));

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 20, y: 20 } } }],
      },
      aomCtx(object),
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

    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
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
      aomCtx(object, { viewport }),
    );

    // 手势启动后立即结束，对象未移动
    expect(object.position).toEqual(new Vector(10, 20));
    // begin+update 触发一次 withGeometryMutation
    // end 不包裹 withGeometryMutation（completeModifyGesture 仅做状态清理）
    expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(1);
    expect(viewport.renderer.invalidateActiveObjects).toHaveBeenCalledTimes(1);

    // 新一轮手势应以新锚点正常启动
    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 20, y: 25 } } }],
      },
      aomCtx(object, { viewport }),
    );
    expect(object.position).toEqual(new Vector(10, 20)); // 新锚点=(20,25)，dx=0

    tool.process(
      {
        signals: [{ type: "position", context: { value: { x: 25, y: 30 } } }],
      },
      aomCtx(object, { viewport }),
    );
    // dx=25-20=5, dy=30-25=5 → (15, 25)
    expect(object.position).toEqual(new Vector(15, 25));
  });

  describe("cancel 多手势回退", () => {
    test("多轮手势后 cancel 应回退到第一轮手势开始前的初始位置", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const tool = new CommonObjectModifierTool();

      // 第一轮手势：锚点 (12, 20)，对象从 (10, 20) 移到 (14, 22)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 12, y: 20 } } }],
        },
        aomCtx(object),
      );
      // 锚点=(12,20)，dx=0 → (10, 20)
      expect(object.position).toEqual(new Vector(10, 20));

      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 16, y: 22 } } }],
        },
        aomCtx(object),
      );
      // dx=4, dy=2 → (14, 22)
      expect(object.position).toEqual(new Vector(14, 22));

      // end 结束第一轮手势
      tool.process({ signals: [{ type: "end" }] }, aomCtx(object));

      // 第二轮手势：锚点 (18, 24)，对象从 (14, 22) 移到 (20, 26)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 18, y: 24 } } }],
        },
        aomCtx(object),
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 24, y: 28 } } }],
        },
        aomCtx(object),
      );
      // dx=24-18=6, dy=28-24=4 → (20, 26)
      expect(object.position).toEqual(new Vector(20, 26));

      // end 结束第二轮手势
      tool.process({ signals: [{ type: "end" }] }, aomCtx(object));

      // cancel → 应回退到第一轮手势开始前的初始位置 (10, 20)，不是 (14, 22)
      tool.process({ signals: [{ type: "cancel" }] }, aomCtx(object));
      expect(object.position).toEqual(new Vector(10, 20));
    });

    test("cancel 后新一轮手势应重新记录初始位置", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const tool = new CommonObjectModifierTool();

      // 第一轮：移动并 cancel
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 15, y: 25 } } }],
        },
        aomCtx(object),
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 20, y: 30 } } }],
        },
        aomCtx(object),
      );
      // dx=5, dy=5 → (15, 25)
      expect(object.position).toEqual(new Vector(15, 25));

      tool.process({ signals: [{ type: "end" }] }, aomCtx(object));
      tool.process({ signals: [{ type: "cancel" }] }, aomCtx(object));
      // cancel 回退到初始位置
      expect(object.position).toEqual(new Vector(10, 20));

      // 第二轮：cancel 后新的手势应能以新的当前位置为基准
      // （_initialPositions 已在 cancelModifyGesture 中被清空）
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 12, y: 22 } } }],
        },
        aomCtx(object),
      );
      // 新锚点=(12,22)，新 initPos=(10,20)，dx=0 → (10,20)
      expect(object.position).toEqual(new Vector(10, 20));

      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 17, y: 27 } } }],
        },
        aomCtx(object),
      );
      // dx=17-12=5, dy=27-22=5 → (15, 25)
      expect(object.position).toEqual(new Vector(15, 25));
    });

    test("success 后 _initialPositions 应被清空，新一组对象不以旧位置为 baseline", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[1, object]]),
          apply: jest.fn(),
        },
      };

      const tool = new CommonObjectModifierTool();

      // 移动并 success
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 15, y: 25 } } }],
        },
        aomCtx(object, { board }),
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 20, y: 30 } } }],
        },
        aomCtx(object, { board }),
      );
      // dx=5, dy=5 → (15, 25)
      expect(object.position).toEqual(new Vector(15, 25));

      tool.process(
        { signals: [{ type: "success", context: {} }] },
        aomCtx(object, { board }),
      );

      // 模拟新对象（id=2）进入 modifier
      const object2 = {
        id: 2,
        position: new Vector(50, 60),
      };
      const board2 = {
        activeObjectManager: {
          activeObjectIndex: new Map([[2, object2]]),
          apply: jest.fn(),
        },
      };

      // 新的手势：应从 object2 的位置开始记录
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 55, y: 65 } } }],
        },
        aomCtx(object2, { board: board2 }),
      );
      // 锚点=(55,65)，新 initPos=(50,60)，dx=0 → (50,60)
      expect(object2.position).toEqual(new Vector(50, 60));

      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 60, y: 70 } } }],
        },
        aomCtx(object2, { board: board2 }),
      );
      // dx=60-55=5, dy=70-65=5 → (55, 65)
      expect(object2.position).toEqual(new Vector(55, 65));
    });
  });

  describe("手势准入检测——边缘场景", () => {
    function makeAomCtx(opts = {}) {
      const { objects, board, viewport } = opts;
      const normalized = objects
        ? Array.isArray(objects)
          ? objects
          : [objects]
        : [];
      return {
        acc: {
          objects: normalized.filter(Boolean),
          board: {
            activeObjectManager: {
              activeObjectIndex: new Map(
                normalized
                  .filter((o) => o && o.id != null)
                  .map((o) => [o.id, o]),
              ),
            },
            ...(board || {}),
          },
          ...(viewport ? { viewport } : {}),
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

      const viewport = {
        renderer: {
          captureObjectSnapshot: jest.fn(),
          invalidateActiveObjects: jest.fn(),
        },
      };

      const tool = new CommonObjectModifierTool();

      // 左上角边界 (10, 20) → 锚点=(10,20)，dx=0 → 对象不动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 10, y: 20 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
      );
      expect(object.position).toEqual(new Vector(10, 20));
      // 第二个 position → 确认手势确实激活并能移动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 15, y: 25 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
      );
      // dx=5, dy=5 → (15, 25)
      expect(object.position).toEqual(new Vector(15, 25));
      tool.reset();

      // 右下角边界 (60, 50) → 锚点=(60,50)，initPos=(15,25)，dx=0
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 60, y: 50 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
      );
      expect(object.position).toEqual(new Vector(15, 25));
      // containsPoint 使用 1e-8 容差，边界点应命中
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 65, y: 55 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
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

      const viewport = {
        renderer: {
          captureObjectSnapshot: jest.fn(),
          invalidateActiveObjects: jest.fn(),
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
        makeAomCtx({ objects: [object], viewport }),
      );
      expect(object.position).toEqual(new Vector(10, 20));
      expect(viewport.renderer.captureObjectSnapshot).not.toHaveBeenCalled();

      // 第二次：position (30, 35) 在内部 → 新锚点，正常启动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 30, y: 35 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
      );
      // 锚点=(30,35)，dx=0 → (10, 20)
      expect(object.position).toEqual(new Vector(10, 20));
      expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(
        1,
      );

      // 第三个 position → 确认位移生效
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 35, y: 40 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
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

      const viewport = {
        renderer: {
          captureObjectSnapshot: jest.fn(),
          invalidateActiveObjects: jest.fn(),
        },
      };

      const tool = new CommonObjectModifierTool();

      // 首个 position (30, 35)：在内部，启动手势，对象不动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 30, y: 35 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
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
        makeAomCtx({ objects: [object], viewport }),
      );
      // 锚点仍为(30,35)，dx=70, dy=165 → (80, 185)
      expect(object.position).toEqual(new Vector(80, 185));
      // 首次 position 抓快照，后续 position 不重复抓取
      expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(
        1,
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
        makeAomCtx({ objects: [object], board }),
      );

      expect(object.position).toEqual(new Vector(10, 20));
    });

    test("end 信号后新一轮手势应重新执行准入检测", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
        getRange: () => new RectangleRange(0, 0, 50, 30),
      };

      const viewport = {
        renderer: {
          captureObjectSnapshot: jest.fn(),
          invalidateActiveObjects: jest.fn(),
        },
      };

      const tool = new CommonObjectModifierTool();

      // 第一轮：启动并移动
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 30, y: 35 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
      );
      // 锚点=(30,35)，dx=0 → (10, 20)
      expect(object.position).toEqual(new Vector(10, 20));

      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 35, y: 40 } } }],
        },
        makeAomCtx({ objects: [object], viewport }),
      );
      // dx=5, dy=5 → (15, 25)
      expect(object.position).toEqual(new Vector(15, 25));

      // end 结束手势
      tool.process(
        { signals: [{ type: "end" }] },
        makeAomCtx({ objects: [object], viewport }),
      );

      // 新一轮：position (100, 200) 在外部 → 应拒绝
      tool.process(
        {
          signals: [
            { type: "position", context: { value: { x: 100, y: 200 } } },
          ],
        },
        makeAomCtx({ objects: [object], viewport }),
      );
      // 准入拒绝，对象位置保持在 end 时刻
      expect(object.position).toEqual(new Vector(15, 25));
      // 仅在首次 position 抓了快照，后续 update 和拒绝的准入都不抓
      expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe("displacement 信号支持", () => {
    test("位移信号单独到达时应直接移动对象，不启动手势状态机", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const viewport = {
        renderer: {
          captureObjectSnapshot: jest.fn(),
          invalidateActiveObjects: jest.fn(),
        },
        requestViewportUiRender: jest.fn(),
      };

      const tool = new CommonObjectModifierTool();
      // displacement (3, 5)：直接累加
      tool.process(
        {
          signals: [
            { type: "displacement", context: { value: { x: 3, y: 5 } } },
          ],
        },
        aomCtx(object, { viewport }),
      );
      expect(object.position).toEqual(new Vector(13, 25));
      // 手势不应激活
      expect(tool.isGestureActive).toBe(false);
      // withGeometryMutation 带 captureSnapshot: false → 仅触发 after
      expect(viewport.requestViewportUiRender).toHaveBeenCalledTimes(1);
      expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledTimes(
        0,
      );
      expect(viewport.renderer.invalidateActiveObjects).toHaveBeenCalledTimes(1);
    });

    test("手势激活期间位移到达：对象位置叠加、锚点跟随同步", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const tool = new CommonObjectModifierTool();

      // 启动手势：锚点=(12, 20)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 12, y: 20 } } }],
        },
        aomCtx(object),
      );
      // dx=0 → (10, 20)
      expect(object.position).toEqual(new Vector(10, 20));

      // 第二个 position (16, 22)：dx=4, dy=2 → (14, 22)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 16, y: 22 } } }],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(14, 22));

      // displacement (3, -1) 到达：对象叠到 (17, 21)，锚点不动，basePos 同步
      tool.process(
        {
          signals: [
            { type: "displacement", context: { value: { x: 3, y: -1 } } },
          ],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(17, 21));

      // 后续 position (22, 25)：锚点(12, 20)不动，基准偏移 = (13, 19)
      // dx = 22 - 12 = 10, dy = 25 - 20 = 5 → basePos (13, 19) + (10, 5) = (23, 24)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 22, y: 25 } } }],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(23, 24));
    });

    test("同一信号包中 position + displacement 应先 position 再位移叠加", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const tool = new CommonObjectModifierTool();

      // 启动手势：锚点=(12, 20)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 12, y: 20 } } }],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(10, 20));

      // 同一帧：position (16, 22) + displacement (3, -1)
      // Step 1 position: dx = 16 - 12 = 4, dy = 22 - 20 = 2 → basePos (10, 20) + (4, 2) = (14, 22)
      // Step 2 displacement: (14, 22) + (3, -1) = (17, 21)，basePos 同步为 (13, 19)
      tool.process(
        {
          signals: [
            { type: "position", context: { value: { x: 16, y: 22 } } },
            { type: "displacement", context: { value: { x: 3, y: -1 } } },
          ],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(17, 21));

      // 后续 position (20, 26)：锚点(12, 20)不动，基准偏移 (13, 19)
      // dx = 20 - 12 = 8, dy = 26 - 20 = 6 → basePos (13, 19) + (8, 6) = (21, 25)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 20, y: 26 } } }],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(21, 25));
    });

    test("end 之后 displacement 应直接累加，无需锚点", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const tool = new CommonObjectModifierTool();

      // 启动并移动：锚点(12, 20) → 位置(10, 20)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 12, y: 20 } } }],
        },
        aomCtx(object),
      );
      // position (16, 22)：dx = 4, dy = 2 → (14, 22)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 16, y: 22 } } }],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(14, 22));

      // end 结束手势
      tool.process({ signals: [{ type: "end" }] }, aomCtx(object));
      expect(tool.isGestureActive).toBe(false);

      // displacement 在 end 后到达：直接累加
      tool.process(
        {
          signals: [
            { type: "displacement", context: { value: { x: 5, y: 3 } } },
          ],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(19, 25));

      // 没有锚点可调，手势仍不活跃
      expect(tool.isGestureActive).toBe(false);
    });

    test("cancel 应回退到手势开始时的初始位置（含 displacement 修正）", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const tool = new CommonObjectModifierTool();

      // 启动手势：锚点(12, 20)，initialPos=(10, 20)
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 12, y: 20 } } }],
        },
        aomCtx(object),
      );

      // 移动 + displacement
      // position (16, 22)：dx = 16 - 12 = 4, dy = 22 - 20 = 2 → basePos (10, 20) + (4, 2) = (14, 22)
      // displacement (2, 0)：→ (16, 22)
      tool.process(
        {
          signals: [
            { type: "position", context: { value: { x: 16, y: 22 } } },
            { type: "displacement", context: { value: { x: 2, y: 0 } } },
          ],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(16, 22));

      // end 结束手势
      tool.process({ signals: [{ type: "end" }] }, aomCtx(object));

      // cancel → 回退到 initialPos = (10, 20)
      tool.process({ signals: [{ type: "cancel" }] }, aomCtx(object));
      expect(object.position).toEqual(new Vector(10, 20));
    });

    test("纯 displacement 多次累加后 cancel 应回退到首次 displacement 前的位置", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };

      const tool = new CommonObjectModifierTool();

      // 位移 1：对象 → (13, 25)，onBeforeDisplacement 记录 _initialPositions
      tool.process(
        {
          signals: [
            { type: "displacement", context: { value: { x: 3, y: 5 } } },
          ],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(13, 25));

      // 位移 2：对象 → (15, 28)
      tool.process(
        {
          signals: [
            { type: "displacement", context: { value: { x: 2, y: 3 } } },
          ],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(15, 28));

      // cancel → 回退到 (10, 20)
      tool.process({ signals: [{ type: "cancel" }] }, aomCtx(object));
      expect(object.position).toEqual(new Vector(10, 20));
    });

    test("displacement 不应触发准入检测（即使 position 在合矩形外）", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
        getRange: () => new RectangleRange(0, 0, 50, 30),
      };

      const tool = new CommonObjectModifierTool();

      // displacement 直接移动，不经过 canBeginModifyGesture
      tool.process(
        {
          signals: [
            { type: "displacement", context: { value: { x: 100, y: 200 } } },
          ],
        },
        aomCtx(object),
      );
      expect(object.position).toEqual(new Vector(110, 220));
    });

    test("多对象 displacement 应移动所有对象", () => {
      const objectA = { id: 1, position: new Vector(10, 20) };
      const objectB = { id: 2, position: new Vector(30, 40) };

      const tool = new CommonObjectModifierTool();
      tool.process(
        {
          signals: [
            { type: "displacement", context: { value: { x: 5, y: -2 } } },
          ],
        },
        aomCtx([objectA, objectB]),
      );

      expect(objectA.position).toEqual(new Vector(15, 18));
      expect(objectB.position).toEqual(new Vector(35, 38));
    });

    test("success 应提交纯 displacement 修改后的对象", () => {
      const object = {
        id: 1,
        position: new Vector(10, 20),
      };
      const boardApi = {
        modifyObject: jest.fn(),
        commitObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };

      const tool = new CommonObjectModifierTool();

      tool.process(
        {
          signals: [
            { type: "displacement", context: { value: { x: 7, y: 3 } } },
          ],
        },
        aomCtx(object, { boardApi }),
      );
      expect(object.position).toEqual(new Vector(17, 23));

      tool.process(
        { signals: [{ type: "success", context: {} }] },
        aomCtx(object, { boardApi }),
      );
      expect(boardApi.commitObjects).toHaveBeenCalledWith([1]);
    });

    test("Worker mode 下 summary-like 对象应能基于 plain boundingBox 启动 modifier 手势", () => {
      const object = {
        id: 1,
        position: { x: 30, y: 40 },
        boundingBox: { left: 0, top: 0, width: 20, height: 10 },
      };
      const boardApi = {
        modifyObject: jest.fn(),
      };
      const tool = new CommonObjectModifierTool();
      const context = {
        acc: {
          objects: [object],
          boardApi,
        },
      };

      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 35, y: 45 } } }],
        },
        context,
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: { x: 45, y: 50 } } }],
        },
        context,
      );

      expect(boardApi.modifyObject).toHaveBeenLastCalledWith(1, {
        position: { x: 40, y: 45 },
      });
      expect(object.position).toEqual(new Vector(40, 45));
    });
  });
});
