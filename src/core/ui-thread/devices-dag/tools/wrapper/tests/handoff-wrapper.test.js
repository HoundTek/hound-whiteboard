/**
 * @file HandoffWrapperTool 测试
 * @description 验证两阶段顺序组合的相位切换、对象桥接与 cancel 回退行为。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { DevicesDAG } from "../../../index.js";
import { HandoffWrapperTool } from "../handoff-wrapper.js";
import { StrokeCreatorTool } from "../../creator/stroke-creator.js";
import { RectangleObjectChooserTool } from "../../chooser/rectangle-object-chooser.js";
import { CommonObjectModifierTool } from "../../modifier/common-object-modifier.js";
import { Vector } from "../../../../../engine/utils/math.js";
import { RectangleRange } from "../../../../../engine/range/rectangle.js";
import {
  createMockCreator,
  createMockModifier,
} from "../../../../../test-support/mock-tools.js";

/**
 * 构造 creator 场景的服务上下文
 * @param {number} objectId - 分配的对象 id
 * @returns {{ services: Object, board: Object, boardApi: Object, viewport: Object }}
 */
function createCreatorServices(objectId) {
  const board = {
    allocateObjectId: jest.fn(() => objectId),
    getObjectById: jest.fn(() => undefined),
    activeObjectManager: {
      activeObjectIndex: new Map(),
      apply: jest.fn(),
    },
  };
  const boardApi = {
    createObject: jest.fn(async () => objectId),
    appendListItem: jest.fn(),
    modifyObject: jest.fn(),
    commitObjects: jest.fn(),
    discardActiveObjects: jest.fn(),
  };
  const viewport = { requestViewportUiRender: jest.fn() };
  return { services: { board, boardApi, viewport }, board, boardApi, viewport };
}

/**
 * 挂载 handoff wrapper 到测试 DAG
 * @param {HandoffWrapperTool} wrapper - handoff 实例
 * @param {Object} services - 静态服务上下文
 * @returns {{ dag: DevicesDAG, wrapper: HandoffWrapperTool }}
 */
function mountHandoff(wrapper, services) {
  const dag = new DevicesDAG();
  dag.mountWorkflow("/viewport/handoff", wrapper);
  dag.configureNode("/", { services });
  return { dag, wrapper };
}

/**
 * 向 handoff 入口分发信号
 * @param {DevicesDAG} dag - 测试 DAG
 * @param {Array<Object>} signals - 信号列表
 * @returns {*} dispatch 结果
 */
function dispatchToHandoff(dag, signals) {
  return dag.dispatch({ to: "/viewport/handoff", signals });
}

describe("HandoffWrapperTool", () => {
  describe("构造校验", () => {
    test("first / second 必须是 Tool 实例", () => {
      expect(() => new HandoffWrapperTool({ first: {}, second: {} })).toThrow(
        TypeError,
      );
      expect(
        () =>
          new HandoffWrapperTool({
            first: createMockModifier(),
            second: null,
          }),
      ).toThrow(TypeError);
    });

    test("first 和 second 为同一实例时应抛错", () => {
      const tool = createMockModifier();
      expect(
        () => new HandoffWrapperTool({ first: tool, second: tool }),
      ).toThrow(/same tool instance/i);
    });

    test("构造时应将 first 的 autoCommit 与 second 的 autoUmountOnApply 置为 false", () => {
      const stroke = new StrokeCreatorTool();
      const modifier = new CommonObjectModifierTool();

      expect(stroke.autoCommit).toBe(true);
      expect(modifier.autoUmountOnApply).toBe(true);

      new HandoffWrapperTool({ first: stroke, second: modifier });

      expect(stroke.autoCommit).toBe(false);
      expect(modifier.autoUmountOnApply).toBe(false);
    });
  });

  test("first 完成 → 相位切到 second，对象桥接到 second 且不提前 commit", () => {
    const stroke = new StrokeCreatorTool();
    const modifier = new CommonObjectModifierTool();
    const wrapper = new HandoffWrapperTool({ first: stroke, second: modifier });
    const { services, boardApi } = createCreatorServices(100);
    const { dag } = mountHandoff(wrapper, services);

    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 1, y: 2 } } },
    ]);
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 2, y: 3 } } },
    ]);
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 3, y: 4 } } },
      { type: "end", context: {} },
    ]);

    // 笔画实际创建：3 个路径点
    expect(stroke._entry.id).toBe(100);
    expect(stroke._entry.data.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    // autoCommit=false 阻止提前提交静态图
    expect(boardApi.commitObjects).not.toHaveBeenCalled();

    // 相位切换 + state 镜像
    expect(wrapper.getDebugInfo().phase).toBe("second");
    expect(dag.getNodeState("/viewport/handoff")).toMatchObject({
      phase: "second",
      activeChild: "second",
    });

    // 对象桥接到 modifier
    expect(modifier._overlayModifiedObjects).toHaveLength(1);
    expect(modifier._overlayModifiedObjects[0].id).toBe(100);

    // 后续信号路由到 second：modifier 开始手势并写入自己的 shell 节点 state
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 1.5, y: 2.5 } } },
    ]);
    expect(modifier.isGestureActive).toBe(true);
    expect(wrapper._getSlot("second").node.state.objects).toHaveLength(1);
    expect(wrapper._getSlot("second").node.state.objects[0].id).toBe(100);
  });

  test("first 完成但无产出对象 → 不切换相位", () => {
    let firstCalls = 0;
    const first = createMockCreator(() => {
      firstCalls++;
    });
    // 不设置 _entry → 完成结果为 null → 空对象数组
    const second = createMockModifier();
    const wrapper = new HandoffWrapperTool({ first, second });
    const { services } = createCreatorServices(1);
    const { dag } = mountHandoff(wrapper, services);

    dispatchToHandoff(dag, [{ type: "position", context: {} }]);

    expect(wrapper.getDebugInfo().phase).toBe("first");
    expect(dag.getNodeState("/viewport/handoff")).toMatchObject({
      phase: "first",
      activeChild: "first",
    });
    expect(second._handoffObjects).toEqual([]);

    // 后续信号仍路由到 first
    dispatchToHandoff(dag, [{ type: "position", context: {} }]);
    expect(firstCalls).toBe(2);
  });

  test("second 完成 → 提交对象并切回 first", () => {
    const object = { id: 7, position: new Vector(5, 5) };
    const first = createMockCreator();
    first._entry = object;
    const second = new CommonObjectModifierTool();
    const wrapper = new HandoffWrapperTool({ first, second });

    const { services, board, boardApi } = createCreatorServices(7);
    board.activeObjectManager.activeObjectIndex.set(object.id, object);
    const { dag } = mountHandoff(wrapper, services);

    // first 完成 → 桥接 object → second
    dispatchToHandoff(dag, [{ type: "position", context: {} }]);
    expect(wrapper.getDebugInfo().phase).toBe("second");

    // 首个 position → 启动手势（对象暂不动）
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 5, y: 5 } } },
    ]);
    // 第二个 position → 应用位移
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 8, y: 6 } } },
    ]);
    // success → 提交并切回 first
    dispatchToHandoff(dag, [{ type: "success", context: {} }]);

    expect(boardApi.commitObjects).toHaveBeenCalledWith([object.id]);
    expect(object.position).toEqual(new Vector(8, 6));
    expect(wrapper.getDebugInfo().phase).toBe("first");
    expect(dag.getNodeState("/viewport/handoff")).toMatchObject({
      phase: "first",
      activeChild: "first",
    });
  });

  test("second 阶段收到 cancel → 回滚几何、丢弃活动对象并切回 first", () => {
    const object = { id: 8, position: new Vector(5, 5) };
    const first = createMockCreator();
    first._entry = object;
    const second = new CommonObjectModifierTool();
    const wrapper = new HandoffWrapperTool({ first, second });

    const { services, board, boardApi, viewport } = createCreatorServices(8);
    board.activeObjectManager.activeObjectIndex.set(object.id, object);
    const { dag } = mountHandoff(wrapper, services);

    dispatchToHandoff(dag, [{ type: "position", context: {} }]);
    expect(wrapper.getDebugInfo().phase).toBe("second");

    // 手势：锚点 (5,5) → 拖到 (8,6)，对象随之移动
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 5, y: 5 } } },
    ]);
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 8, y: 6 } } },
    ]);
    expect(object.position).toEqual(new Vector(8, 6));

    dispatchToHandoff(dag, [{ type: "cancel", context: {} }]);

    // cancel 手势回滚几何
    expect(object.position).toEqual(new Vector(5, 5));
    // wrapper 显式丢弃 second 持有的活动对象（对齐旧 completeOnCancel 语义）
    expect(boardApi.discardActiveObjects).toHaveBeenCalledWith([object.id]);
    expect(wrapper.getDebugInfo().phase).toBe("first");
    expect(dag.getNodeState("/viewport/handoff")).toMatchObject({
      phase: "first",
      activeChild: "first",
    });
    expect(viewport.requestViewportUiRender).toHaveBeenCalled();
  });

  test("异步完成（RectangleObjectChooserTool 的 Promise 完成）→ 正确切换", async () => {
    const chooser = new RectangleObjectChooserTool();
    const modifier = createMockModifier();
    const wrapper = new HandoffWrapperTool({ first: chooser, second: modifier });

    const selectedSummary = {
      id: 199,
      type: "CircleObject",
      position: { x: 12, y: 12 },
      range: new RectangleRange(-8, -8, 16, 16),
      boundingBox: new RectangleRange(-8, -8, 16, 16),
      property: {},
      data: { radius: 8 },
    };
    const boardApi = {
      hitTest: jest.fn(async () => [199]),
      queryObjects: jest.fn(async () => [selectedSummary]),
      addActiveObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const viewport = { requestViewportUiRender: jest.fn() };
    const { dag } = mountHandoff(wrapper, {
      board: {},
      boardApi,
      viewport,
    });

    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 0, y: 0 } } },
    ]);
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 30, y: 30 } } },
      { type: "end", context: {} },
    ]);

    // 异步选择完成后才切换相位
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(boardApi.hitTest).toHaveBeenCalled();
    expect(boardApi.queryObjects).toHaveBeenCalledWith([199]);
    expect(wrapper.getDebugInfo().phase).toBe("second");
    expect(dag.getNodeState("/viewport/handoff")).toMatchObject({
      phase: "second",
      activeChild: "second",
    });
    // 选中对象桥接到 second
    expect(modifier._handoffObjects).toEqual([selectedSummary]);
  });

  test("endAction 传播到当前相位工具并完成其动作", () => {
    const stroke = new StrokeCreatorTool();
    const modifier = new CommonObjectModifierTool();
    const wrapper = new HandoffWrapperTool({ first: stroke, second: modifier });
    const { services } = createCreatorServices(300);
    const { dag } = mountHandoff(wrapper, services);

    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 1, y: 1 } } },
    ]);
    dispatchToHandoff(dag, [
      { type: "position", context: { value: { x: 4, y: 5 } } },
    ]);
    expect(stroke.isGestureActive).toBe(true);
    expect(wrapper.getDebugInfo().phase).toBe("first");

    // 外部（如 tool-switcher 切换）强制结束当前动作
    wrapper.endAction({ services });

    // first 的手势被优雅完成 → action:complete → 相位切到 second
    expect(stroke.isGestureActive).toBe(false);
    expect(wrapper.getDebugInfo().phase).toBe("second");
    expect(modifier._overlayModifiedObjects).toHaveLength(1);
    expect(modifier._overlayModifiedObjects[0].id).toBe(300);
  });

  test("autoBridgeObjects = false 时跳过对象桥接但仍切换相位", () => {
    const first = createMockCreator();
    first._entry = { id: 42, type: "circle" };
    const second = createMockModifier();
    const wrapper = new HandoffWrapperTool({
      first,
      second,
      autoBridgeObjects: false,
    });
    const { services } = createCreatorServices(42);
    const { dag } = mountHandoff(wrapper, services);

    dispatchToHandoff(dag, [{ type: "position", context: {} }]);

    expect(wrapper.getDebugInfo().phase).toBe("second");
    expect(second._handoffObjects).toEqual([]);
  });
});
