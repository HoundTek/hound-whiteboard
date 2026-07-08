import { createSubDAG } from "../../index.js";
import { createKeyboardDevice } from "../../devices/keyboard-device.js";
import { createWorkerBoardContext } from "../../../../test-support/worker-mode-fixtures.js";

describe("edge.prefix", () => {
  test("edge.prefix 应支持多节点线性链", async () => {
    const { board, viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "main",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const keyboardDevice = createKeyboardDevice();
      viewport.mountSubDAG("", keyboardDevice);

      const receivedPackets = [];
      const workflow = {
        createProcessor: () => (packet) => {
          receivedPackets.push({ to: packet.to, signals: packet.signals });
          return [];
        },
      };

      const builder = createSubDAG("/");
      const a = builder
        .node()
        .handler((packet) => ({
          signals: packet.signals.map((s) => ({
            ...s,
            context: {
              ...s.context,
              steps: [...(s.context?.steps ?? []), "a"],
            },
          })),
        }))
        .defaultRoute("next");
      const b = builder
        .node()
        .handler((packet) => ({
          signals: packet.signals.map((s) => ({
            ...s,
            context: {
              ...s.context,
              steps: [...(s.context?.steps ?? []), "b"],
            },
          })),
        }))
        .defaultRoute("next");
      const c = builder
        .node()
        .handler((packet) => ({
          signals: packet.signals.map((s) => ({
            ...s,
            context: {
              ...s.context,
              steps: [...(s.context?.steps ?? []), "c"],
            },
          })),
        }))
        .defaultRoute("default");
      builder.edge("next", a, b);
      builder.edge("next", b, c);
      const chain = builder.build();

      board.signalsEventBus.emit("mount", {
        viewportId: "main",
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

      viewport.devicesDAG.dispatch({
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
    } finally {
      cleanup();
    }
  });

  test("edge.prefix 应支持多节点分支 DAG（发散-收敛）", async () => {
    const { board, viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "main",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const keyboardDevice = createKeyboardDevice();
      viewport.mountSubDAG("", keyboardDevice);

      const receivedPackets = [];
      const workflow = {
        createProcessor: () => (packet) => {
          receivedPackets.push({ to: packet.to, signals: packet.signals });
          return [];
        },
      };

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
        viewportId: "main",
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

      viewport.devicesDAG.dispatch({
        to: "/main/keyboard",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyW", key: "w", repeat: false },
          },
        ],
      });

      expect(receivedPackets).toHaveLength(2);
      expect(
        receivedPackets.map((p) => p.signals[0].context.branch).sort(),
      ).toEqual(["a", "b"]);
    } finally {
      cleanup();
    }
  });
});
