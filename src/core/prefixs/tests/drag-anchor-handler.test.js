import { DevicesDAG, createSubDAG } from "../../devices/devices-dag.js";
import { createDragAnchorPrefixHandler } from "../drag-anchor-handler.js";

describe("drag-anchor-handler", () => {
  test("首个 position 信号应捕获锚点，不转发", () => {
    const ddag = new DevicesDAG();
    const _dag1 = createSubDAG("/drag");
    const _r1 = _dag1
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t1 = _dag1.node().handler((pkt, ctx) => ({
      to: "",
      signals: pkt.signals,
    }));
    _dag1.edge("tool", _r1, _t1);
    const subTree = _dag1.build();

    ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

    const result = ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
    });

    // 首个 position：捕获锚点，不转发
    expect(result.packets).toEqual([]);
  });

  test("后续 position 信号应输出累计位移 {x, y}", () => {
    const ddag = new DevicesDAG();
    const _dag1 = createSubDAG("/drag");
    const _r1 = _dag1
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t1 = _dag1.node().handler((pkt, ctx) => ({
      to: "",
      signals: pkt.signals,
    }));
    _dag1.edge("tool", _r1, _t1);
    const subTree = _dag1.build();

    ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

    // 第一个：捕获锚点 (100, 200)
    ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
    });

    // 第二个：累计位移 (120-100, 220-200) = (20, 20)
    const result = ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 120, y: 220 } } }],
    });

    expect(result.packets).toEqual([
      {
        to: "",
        signals: [
          { type: "displacement", context: { value: { x: 20, y: 20 } } },
        ],
      },
    ]);
  });

  test("end 信号应清空锚点并转发 end", () => {
    const ddag = new DevicesDAG();
    const _dag2 = createSubDAG("/drag");
    const _r2 = _dag2
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t2 = _dag2.node().handler((pkt, ctx) => ({
      to: "",
      signals: pkt.signals,
    }));
    _dag2.edge("tool", _r2, _t2);
    const subTree = _dag2.build();

    ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

    // 先建立锚点
    ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
    });

    // 发送 end
    const result = ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "end" }],
    });

    expect(result.packets).toEqual([{ to: "", signals: [{ type: "end" }] }]);

    // 验证锚点已清空：下一个 position 应再次成为"首个"
    const result2 = ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 50, y: 80 } } }],
    });

    expect(result2.packets).toEqual([]);
  });

  test("非 position 信号应直接转发不改变锚点", () => {
    const ddag = new DevicesDAG();
    const _dag3 = createSubDAG("/drag");
    const _r3 = _dag3
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t3 = _dag3.node().handler((pkt, ctx) => ({
      to: "",
      signals: pkt.signals,
    }));
    _dag3.edge("tool", _r3, _t3);
    const subTree = _dag3.build();

    ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

    ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 10, y: 20 } } }],
    });

    // 非 position 信号不影响锚点，直接转发
    const result = ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "success" }],
    });

    expect(result.packets).toEqual([
      { to: "", signals: [{ type: "success" }] },
    ]);

    // 锚点仍存在：下一个 position 应计算累计位移
    const result2 = ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 25, y: 40 } } }],
    });

    expect(result2.packets).toEqual([
      {
        to: "",
        signals: [
          { type: "displacement", context: { value: { x: 15, y: 20 } } },
        ],
      },
    ]);
  });

  test("连续拖动应输出累计位移（锚点不变）", () => {
    const ddag = new DevicesDAG();
    const trace = [];

    const _dag4 = createSubDAG("/drag");
    const _r4 = _dag4
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t4 = _dag4.node().handler((pkt) => {
      trace.push(pkt.signals[0]?.context?.value);
      return [];
    });
    _dag4.edge("tool", _r4, _t4);
    const subTree = _dag4.build();

    ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

    // 帧 0: 锚点 (100, 100)
    ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 100 } } }],
    });
    // 帧 1: 累计位移 = (110-100, 105-100) = (10, 5)
    ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 110, y: 105 } } }],
    });
    // 帧 2: 累计位移 = (125-100, 110-100) = (25, 10)
    ddag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 125, y: 110 } } }],
    });

    expect(trace).toEqual([
      { x: 10, y: 5 },
      { x: 25, y: 10 },
    ]);
  });

  test("在缩放场景下应以世界坐标增量正确计算位移", () => {
    const ddag = new DevicesDAG();
    const trace = [];

    const _dag5 = createSubDAG("/zoom-drag");
    const _r5 = _dag5
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t5 = _dag5.node().handler((pkt) => {
      trace.push(pkt.signals[0]?.context?.value);
      return [];
    });
    _dag5.edge("tool", _r5, _t5);
    const subTree = _dag5.build();

    ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

    // zoom=2: 屏幕移动 (50, 50) 像素，世界位移应为 (25, 25)
    // 首帧锚点
    ddag.dispatch({
      to: "/monitor/zoom-drag",
      signals: [{ type: "position", context: { value: { x: 200, y: 150 } } }],
    });
    // 第二帧 (225, 175) → 累计 {x: 25, y: 25}
    ddag.dispatch({
      to: "/monitor/zoom-drag",
      signals: [{ type: "position", context: { value: { x: 225, y: 175 } } }],
    });
    // 第三帧 (260, 200) → 累计 {x: 60, y: 50}
    ddag.dispatch({
      to: "/monitor/zoom-drag",
      signals: [{ type: "position", context: { value: { x: 260, y: 200 } } }],
    });

    expect(trace).toEqual([
      { x: 25, y: 25 },
      { x: 60, y: 50 },
    ]);
  });

  test("缩放变化后开始新拖拽应使用新的锚点", () => {
    const ddag = new DevicesDAG();
    const trace = [];

    const _dag6 = createSubDAG("/zoom-reset");
    const _r6 = _dag6
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t6 = _dag6.node().handler((pkt) => {
      trace.push(pkt.signals[0]?.context?.value);
      return [];
    });
    _dag6.edge("tool", _r6, _t6);
    const subTree = _dag6.build();

    ddag.mountSubDAG("/monitor", subTree, { board: {}, monitor: {} });

    // zoom=1 时拖拽一段
    ddag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "position", context: { value: { x: 300, y: 200 } } }],
    });
    ddag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "position", context: { value: { x: 320, y: 220 } } }],
    });
    ddag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "end" }],
    });
    expect(trace).toEqual([{ x: 20, y: 20 }]);

    // zoom=2 时新拖拽，锚点应重建
    ddag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "position", context: { value: { x: 400, y: 300 } } }],
    });
    ddag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "position", context: { value: { x: 440, y: 340 } } }],
    });
    expect(trace[trace.length - 1]).toEqual({ x: 40, y: 40 });
  });
});
