/**
 * @file 屏幕坐标→世界坐标转换 prefix 测试
 * @description 验证 createCanvasToWorldPrefixHandler 在各种场景下的坐标转换行为。
 * @module core/ui/devices-dag/prefixes/tests/screen-to-world-handler.test
 * @author Zhou Chenyu
 */

import { DevicesDAG, createSubDAG } from "../../index.js";
import { createCanvasToWorldPrefixHandler } from "../index.js";
import { Vector } from "../../../../engine/utils/math.js";

describe("createCanvasToWorldPrefixHandler", () => {
  /**
   * 创建一个模拟视口
   * @param {number} zoom - 缩放倍率
   * @param {number} originX - 世界原点 x
   * @param {number} originY - 世界原点 y
   * @returns {Object} 模拟视口
   */
  function createMockViewport(zoom = 2, originX = 100, originY = 200) {
    return {
      zoom,
      origin: { x: originX, y: originY },
    };
  }

  const setupDAG = (mockViewport) => {
    const dag = new DevicesDAG();
    const viewportId = "vp1";

    // 创建子树：entry → screen-to-world prefix → tool
    const builder = createSubDAG("/mouse");
    const entry = builder.node().defaultRoute("pointer");
    const prefixNode = builder
      .node()
      .defaultRoute("tool")
      .prefix(createCanvasToWorldPrefixHandler());

    const toolNode = builder.node().handler((packet, context) => ({
      packets: [
        {
          to: "",
          signals: packet.signals,
        },
      ],
    }));

    builder.edge("pointer", entry, prefixNode);
    builder.edge("tool", prefixNode, toolNode);

    dag.mountSubDAG(`/${viewportId}`, builder.build());

    // 模拟 Board.createViewport 的行为——在视口根节点注入视口实例
    dag.configureNode(viewportId, {
      services: { viewport: mockViewport },
      semantics: { viewport: true },
    });

    return { dag, viewportId };
  };

  test("应将屏幕坐标 position 转换为世界坐标", () => {
    const zoom = 2;
    const originX = 100;
    const originY = 200;
    const mockViewport = createMockViewport(zoom, originX, originY, {
      left: 0,
      top: 0,
    });
    const { dag, viewportId } = setupDAG(mockViewport);

    // 屏幕坐标 (clientX=400, clientY=300)
    // 期望世界坐标: (400/2 + 100, 300/2 + 200) = (300, 350)
    const result = dag.dispatch({
      to: `/${viewportId}/mouse/pointer`,
      signals: [
        {
          type: "position",
          context: {
            value: new Vector(400, 300),
            button: 0,
            buttons: 1,
          },
        },
      ],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toHaveLength(1);

    const [signal] = result.packets[0].signals;
    expect(signal.type).toBe("position");
    expect(signal.context.value).toBeInstanceOf(Vector);
    expect(signal.context.value.x).toBeCloseTo(300);
    expect(signal.context.value.y).toBeCloseTo(350);
    // 非 value 字段应原样保留
    expect(signal.context.button).toBe(0);
    expect(signal.context.buttons).toBe(1);
  });

  test("canvas 相对坐标应正确转换为世界坐标", () => {
    const mockViewport = createMockViewport(1, 0, 0);
    const { dag, viewportId } = setupDAG(mockViewport);

    // canvas 相对坐标 (150, 120)
    // zoom=1, origin=(0,0) → world = (150, 120)
    const result = dag.dispatch({
      to: `/${viewportId}/mouse/pointer`,
      signals: [
        {
          type: "position",
          context: { value: new Vector(150, 120) },
        },
      ],
    });

    expect(result.packets[0].signals[0].context.value).toEqual(
      new Vector(150, 120),
    );
  });

  test("非 position 信号应原样透传", () => {
    const mockViewport = createMockViewport();
    const { dag, viewportId } = setupDAG(mockViewport);

    const result = dag.dispatch({
      to: `/${viewportId}/mouse/pointer`,
      signals: [
        { type: "end", context: { button: 0, buttons: 0 } },
        { type: "custom", context: { data: "hello" } },
      ],
    });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals).toEqual([
      { type: "end", context: { button: 0, buttons: 0 } },
      { type: "custom", context: { data: "hello" } },
    ]);
  });

  test("混合信号包：只转换 position，保留其他", () => {
    const mockViewport = createMockViewport(1, 0, 0);
    const { dag, viewportId } = setupDAG(mockViewport);

    const result = dag.dispatch({
      to: `/${viewportId}/mouse/pointer`,
      signals: [
        { type: "custom", context: { phase: "start" } },
        {
          type: "position",
          context: { value: new Vector(100, 200), button: 0 },
        },
        { type: "end", context: { button: 0 } },
      ],
    });

    const signals = result.packets[0].signals;
    expect(signals).toHaveLength(3);
    // first 不变
    expect(signals[0]).toEqual({ type: "custom", context: { phase: "start" } });
    // second 已转换（zoom=1, origin=0 → world = screen）
    expect(signals[1].type).toBe("position");
    expect(signals[1].context.value).toEqual(new Vector(100, 200));
    expect(signals[1].context.button).toBe(0);
    // third 不变
    expect(signals[2]).toEqual({ type: "end", context: { button: 0 } });
  });

  test("value 为 { x, y } 纯对象时也应正确转换", () => {
    const mockViewport = createMockViewport(2, 0, 0);
    const { dag, viewportId } = setupDAG(mockViewport);

    const result = dag.dispatch({
      to: `/${viewportId}/mouse/pointer`,
      signals: [
        {
          type: "position",
          context: { value: { x: 800, y: 600 } },
        },
      ],
    });

    expect(result.packets[0].signals[0].context.value).toBeInstanceOf(Vector);
    expect(result.packets[0].signals[0].context.value.x).toBeCloseTo(400);
    expect(result.packets[0].signals[0].context.value.y).toBeCloseTo(300);
  });

  test("视口不可达时应原样透传所有信号", () => {
    const dag = new DevicesDAG();
    const builder = createSubDAG("/mouse");
    const entry = builder.node().defaultRoute("pointer");
    const prefixNode = builder
      .node()
      .defaultRoute("tool")
      .prefix(createCanvasToWorldPrefixHandler());

    const toolNode = builder.node().handler((packet, context) => ({
      packets: [{ to: "", signals: packet.signals }],
    }));

    builder.edge("pointer", entry, prefixNode);
    builder.edge("tool", prefixNode, toolNode);

    dag.mountSubDAG("/some-vp", builder.build());

    const result = dag.dispatch({
      to: "/some-vp/mouse/pointer",
      signals: [
        {
          type: "position",
          context: { value: new Vector(100, 200) },
        },
      ],
    });

    // services 中没有 viewport，视口不可达，应原样透传
    expect(result.packets).toHaveLength(1);
    expect(result.packets[0].signals[0].context.value).toEqual(
      new Vector(100, 200),
    );
  });

  test("zoom 或 origin 缺失时应保留原始值", () => {
    const badViewport = { zoom: 2 }; // 缺少 origin
    const { dag, viewportId } = setupDAG(badViewport);

    const result = dag.dispatch({
      to: `/${viewportId}/mouse/pointer`,
      signals: [
        {
          type: "position",
          context: { value: new Vector(100, 200) },
        },
      ],
    });

    expect(result.packets[0].signals[0].type).toBe("position");
    expect(result.packets[0].signals[0].context.value).toEqual(
      new Vector(100, 200),
    );
  });

  test("prefix 应优先委托 viewport.convertCanvasSignalsToWorld 保持逻辑一致", () => {
    let delegatedCallCount = 0;
    const mockViewport = {
      zoom: 2,
      origin: { x: 100, y: 200 },
      convertCanvasSignalsToWorld(signals) {
        delegatedCallCount++;
        return signals.map((signal) => {
          if (signal.type === "position" && signal.context?.value) {
            const raw = signal.context.value;
            return {
              ...signal,
              context: {
                ...signal.context,
                value: {
                  x: raw.x / this.zoom + this.origin.x,
                  y: raw.y / this.zoom + this.origin.y,
                },
              },
            };
          }
          return signal;
        });
      },
    };
    const { dag, viewportId } = setupDAG(mockViewport);

    dag.dispatch({
      to: `/${viewportId}/mouse/pointer`,
      signals: [
        {
          type: "position",
          context: { value: new Vector(100, 200) },
        },
      ],
    });

    // prefix 应委托 viewport.convertCanvasSignalsToWorld
    expect(delegatedCallCount).toBe(1);
  });
});
