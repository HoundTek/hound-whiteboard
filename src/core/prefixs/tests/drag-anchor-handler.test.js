import { DevicesDAG, createSubDAG } from "../../devices-dag/index.js";
import { createDragAnchorPrefixHandler } from "../drag-anchor-handler.js";

describe("drag-anchor-handler", () => {
  test("首个 position 信号应捕获锚点并输出位移 {0, 0}", () => {
    const dag = new DevicesDAG();
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
    const subDAG = _dag1.build();

    dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

    const result = dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
    });

    // 首个 position：捕获锚点，输出 displacement {0, 0}
    expect(result.packets).toEqual([
      {
        to: "",
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 0, y: 0 },
              position: { x: 100, y: 200 },
            },
          },
        ],
      },
    ]);
  });

  test("后续 position 信号应输出累计位移 {x, y}", () => {
    const dag = new DevicesDAG();
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
    const subDAG = _dag1.build();

    dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

    // 第一个：捕获锚点 (100, 200)
    dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
    });

    // 第二个：累计位移 (120-100, 220-200) = (20, 20)
    const result = dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 120, y: 220 } } }],
    });

    expect(result.packets).toEqual([
      {
        to: "",
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 20, y: 20 },
              position: { x: 120, y: 220 },
            },
          },
        ],
      },
    ]);
  });

  test("end 信号应清空锚点并转发 end", () => {
    const dag = new DevicesDAG();
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
    const subDAG = _dag2.build();

    dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

    // 先建立锚点
    dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 200 } } }],
    });

    // 发送 end
    const result = dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "end" }],
    });

    expect(result.packets).toEqual([{ to: "", signals: [{ type: "end" }] }]);

    // 验证锚点已清空：下一个 position 应新建锚点并输出 {0, 0}
    const result2 = dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 50, y: 80 } } }],
    });

    expect(result2.packets).toEqual([
      {
        to: "",
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 0, y: 0 },
              position: { x: 50, y: 80 },
            },
          },
        ],
      },
    ]);
  });

  test("非 position 信号应直接转发不改变锚点", () => {
    const dag = new DevicesDAG();
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
    const subDAG = _dag3.build();

    dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

    dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 10, y: 20 } } }],
    });

    // 非 position 信号不影响锚点，直接转发
    const result = dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "success" }],
    });

    expect(result.packets).toEqual([
      { to: "", signals: [{ type: "success" }] },
    ]);

    // 锚点仍存在：下一个 position 应计算累计位移
    const result2 = dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 25, y: 40 } } }],
    });

    expect(result2.packets).toEqual([
      {
        to: "",
        signals: [
          {
            type: "displacement",
            context: {
              value: { x: 15, y: 20 },
              position: { x: 25, y: 40 },
            },
          },
        ],
      },
    ]);
  });

  test("position + 其他信号同包时，position 被替换为 displacement，其余信号保留", () => {
    const dag = new DevicesDAG();
    const anchorWorkflow = createSubDAG("/drag");
    const _r = anchorWorkflow
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t = anchorWorkflow.node().handler((pkt, ctx) => ({
      to: "",
      signals: pkt.signals,
    }));
    anchorWorkflow.edge("tool", _r, _t);
    const subDAG = anchorWorkflow.build();

    dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

    // 建立锚点
    dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 100 } } }],
    });

    // 同包发送 position + success + end，end 清空锚点，但 position 仍转为 displacement
    const result = dag.dispatch({
      to: "/monitor/drag",
      signals: [
        { type: "position", context: { value: { x: 130, y: 150 } } },
        { type: "success" },
        { type: "end" },
      ],
    });

    // end 分支：position 替换为 displacement，其余信号（含 end）保留
    expect(result.packets).toEqual([
      {
        to: "",
        signals: [
          { type: "success" },
          { type: "end" },
          {
            type: "displacement",
            context: {
              value: { x: 30, y: 50 },
              position: { x: 130, y: 150 },
            },
          },
        ],
      },
    ]);

    // 重新建立锚点
    dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 0, y: 0 } } }],
    });

    // 同包发送 position + 自定义信号：position 被替换，custom 保留
    const result2 = dag.dispatch({
      to: "/monitor/drag",
      signals: [
        { type: "position", context: { value: { x: 50, y: 60 } } },
        { type: "custom", context: { value: "hello" } },
      ],
    });

    expect(result2.packets).toEqual([
      {
        to: "",
        signals: [
          // position 已被移除
          { type: "custom", context: { value: "hello" } },
          {
            type: "displacement",
            context: {
              value: { x: 50, y: 60 },
              position: { x: 50, y: 60 },
            },
          },
        ],
      },
    ]);
  });

  test("连续拖动应输出累计位移（锚点不变）", () => {
    const dag = new DevicesDAG();
    const trace = [];

    const _dag4 = createSubDAG("/drag");
    const _r4 = _dag4
      .node()
      .prefix(createDragAnchorPrefixHandler())
      .defaultRoute("tool");
    const _t4 = _dag4.node().handler((pkt) => {
      const ctx = pkt.signals[0]?.context;
      trace.push({
        value: ctx?.value,
        position: ctx?.position,
      });
      return [];
    });
    _dag4.edge("tool", _r4, _t4);
    const subDAG = _dag4.build();

    dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

    // 帧 0: 锚点 (100, 100)
    dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 100, y: 100 } } }],
    });
    // 帧 1: 累计位移 = (110-100, 105-100) = (10, 5)
    dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 110, y: 105 } } }],
    });
    // 帧 2: 累计位移 = (125-100, 110-100) = (25, 10)
    dag.dispatch({
      to: "/monitor/drag",
      signals: [{ type: "position", context: { value: { x: 125, y: 110 } } }],
    });

    expect(trace).toEqual([
      {
        value: { x: 0, y: 0 },
        position: { x: 100, y: 100 },
      },
      {
        value: { x: 10, y: 5 },
        position: { x: 110, y: 105 },
      },
      {
        value: { x: 25, y: 10 },
        position: { x: 125, y: 110 },
      },
    ]);
  });

  test("在缩放场景下应以世界坐标增量正确计算位移", () => {
    const dag = new DevicesDAG();
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
    const subDAG = _dag5.build();

    dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

    // zoom=2: 屏幕移动 (50, 50) 像素，世界位移应为 (25, 25)
    // 首帧锚点
    dag.dispatch({
      to: "/monitor/zoom-drag",
      signals: [{ type: "position", context: { value: { x: 200, y: 150 } } }],
    });
    // 第二帧 (225, 175) → 累计 {x: 25, y: 25}
    dag.dispatch({
      to: "/monitor/zoom-drag",
      signals: [{ type: "position", context: { value: { x: 225, y: 175 } } }],
    });
    // 第三帧 (260, 200) → 累计 {x: 60, y: 50}
    dag.dispatch({
      to: "/monitor/zoom-drag",
      signals: [{ type: "position", context: { value: { x: 260, y: 200 } } }],
    });

    expect(trace).toEqual([
      { x: 0, y: 0 },
      { x: 25, y: 25 },
      { x: 60, y: 50 },
    ]);
  });

  test("缩放变化后开始新拖拽应使用新的锚点", () => {
    const dag = new DevicesDAG();
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
    const subDAG = _dag6.build();

    dag.mountSubDAG("/monitor", subDAG, { board: {}, monitor: {} });

    // zoom=1 时拖拽一段
    dag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "position", context: { value: { x: 300, y: 200 } } }],
    });
    dag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "position", context: { value: { x: 320, y: 220 } } }],
    });
    dag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "end" }],
    });
    expect(trace).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);

    // zoom=2 时新拖拽，锚点应重建
    dag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "position", context: { value: { x: 400, y: 300 } } }],
    });
    dag.dispatch({
      to: "/monitor/zoom-reset",
      signals: [{ type: "position", context: { value: { x: 440, y: 340 } } }],
    });
    expect(trace[trace.length - 1]).toEqual({ x: 40, y: 40 });
  });
});
