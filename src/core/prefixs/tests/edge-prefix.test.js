import { Board } from "../../components/board.js";
import { Monitor } from "../../components/monitor.js";
import { createSubDAG } from "../../devices-dag/index.js";
import { createKeyboardDevice } from "../../devices/keyboard-device.js";
import { createNoopCanvas } from "../../test-support/noop-canvas.js";

describe("edge.prefix", () => {
  function createCanvas() {
    return createNoopCanvas({ width: 800, height: 600 });
  }

  function createMonitor(board, monitorId = "monitor") {
    board.width = 800;
    board.height = 600;
    const monitor = new Monitor(
      createCanvas(),
      board,
      { width: 800, height: 600 },
      monitorId,
    );
    board.monitors.set(monitorId, monitor);
    return monitor;
  }

  test("edge.prefix 应支持多节点线性链", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const keyboardDevice = createKeyboardDevice();
    monitor.mountSubDAG("", keyboardDevice);

    // 三段 prefix：trigger → step1 → step2 → step3
    const receivedPackets = [];
    const workflow = {
      createProcessor: () => (packet) => {
        receivedPackets.push({ to: packet.to, signals: packet.signals });
        return [];
      },
    };

    // 手动构建多节点链
    const builder = createSubDAG("/");
    const a = builder
      .node()
      .handler((packet) => ({
        signals: packet.signals.map((s) => ({
          ...s,
          context: { ...s.context, steps: [...(s.context?.steps ?? []), "a"] },
        })),
      }))
      .defaultRoute("next");
    const b = builder
      .node()
      .handler((packet) => ({
        signals: packet.signals.map((s) => ({
          ...s,
          context: { ...s.context, steps: [...(s.context?.steps ?? []), "b"] },
        })),
      }))
      .defaultRoute("next");
    const c = builder
      .node()
      .handler((packet) => ({
        signals: packet.signals.map((s) => ({
          ...s,
          context: { ...s.context, steps: [...(s.context?.steps ?? []), "c"] },
        })),
      }))
      .defaultRoute("default");
    builder.edge("next", a, b);
    builder.edge("next", b, c);
    const chain = builder.build();

    board.signalsEventBus.emit("mount", {
      monitorId: "main",
      name: "chain-workflow",
      workflow,
      edges: [
        {
          from: "/keyboard/code/KeyW",
          edge: "default",
          prefix: chain,
        },
      ],
    });

    monitor.devicesDAG.dispatch({
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyW", key: "w", repeat: false },
        },
      ],
    });

    expect(receivedPackets).toHaveLength(1);
    expect(receivedPackets[0].signals).toHaveLength(1);
    expect(receivedPackets[0].signals[0].context.steps).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("edge.prefix 应支持多节点分支 DAG（发散-收敛）", () => {
    const board = new Board();
    const monitor = createMonitor(board, "main");
    const keyboardDevice = createKeyboardDevice();
    monitor.mountSubDAG("", keyboardDevice);

    const receivedPackets = [];
    const workflow = {
      createProcessor: () => (packet) => {
        receivedPackets.push({ to: packet.to, signals: packet.signals });
        return [];
      },
    };

    // 分支 DAG：source → A ──→ sink
    //           source → B ──→ sink
    const builder = createSubDAG("/");
    const source = builder.node().handler((packet) => ({
      packets: [
        {
          to: "a",
          signals: packet.signals.map((s) => ({
            ...s,
            context: { ...s.context, source: true, branch: "a" },
          })),
        },
        {
          to: "b",
          signals: packet.signals.map((s) => ({
            ...s,
            context: { ...s.context, source: true, branch: "b" },
          })),
        },
      ],
    }));
    const a = builder
      .node()
      .handler((packet) => ({
        signals: packet.signals,
      }))
      .defaultRoute("sink");
    const b = builder
      .node()
      .handler((packet) => ({
        signals: packet.signals,
      }))
      .defaultRoute("sink");
    const sink = builder
      .node()
      .handler((packet) => ({
        signals: packet.signals,
      }))
      .defaultRoute("default");

    builder.edge("a", source, a);
    builder.edge("b", source, b);
    builder.edge("sink", a, sink);
    builder.edge("sink", b, sink);
    const dagPrefix = builder.build();

    board.signalsEventBus.emit("mount", {
      monitorId: "main",
      name: "branch-workflow",
      workflow,
      edges: [
        {
          from: "/keyboard/code/KeyW",
          edge: "default",
          prefix: dagPrefix,
        },
      ],
    });

    monitor.devicesDAG.dispatch({
      to: "/main/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyW", key: "w", repeat: false },
        },
      ],
    });

    // sink 处理后的两条信号分别到达 workflow
    expect(receivedPackets).toHaveLength(2);
    expect(
      receivedPackets.map((p) => p.signals[0].context.branch).sort(),
    ).toEqual(["a", "b"]);
  });
});
