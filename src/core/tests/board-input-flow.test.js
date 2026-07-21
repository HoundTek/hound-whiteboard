import { Board } from "../ui-thread/components/orchestration/board.js";
import { createSubDAG } from "../ui-thread/devices-dag/index.js";
import { createEdgePrefix } from "../ui-thread/devices-dag/prefixes/index.js";
import { createKeyboardDevice } from "../ui-thread/devices-dag/devices/keyboard-device.js";
import { CollectingTool } from "../test-support/mock-tools.js";
import { createWorkerBoardContext } from "../test-support/worker-mode-fixtures.js";

describe("Board input flow", () => {
  test("input 事件应经由 Board、Viewport 与 DevicesDAG 落到工具节点", async () => {
    const { board, viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "main",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const tool = new CollectingTool();

      const sampleBuilder = createSubDAG("/sample-device");
      const sampleRoot = sampleBuilder.node().defaultRoute("tool");
      const sampleTool = sampleBuilder.node().handler(tool.createProcessor());
      sampleBuilder.edge("tool", sampleRoot, sampleTool);

      viewport.inputScope.mountDevice("", sampleBuilder.build());

      const emitResults = board.signalsEventBus.emit("input", {
        to: "/main/sample-device",
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      });

      expect(emitResults).toEqual([undefined]);
      expect(tool.calls).toHaveLength(1);
      expect(tool.calls[0].signalPacket.to).toBe("");
      expect(tool.calls[0].signalPacket.signals).toEqual([
        { type: "position", context: { value: { x: 3, y: 4 } } },
      ]);
      expect(tool.calls[0].context).toEqual(
        expect.objectContaining({
          services: expect.objectContaining({ board, viewport }),
          path: "/main/sample-device/tool",
        }),
      );
    } finally {
      cleanup();
    }
  });

  test("input 事件指向不存在的 viewport 时应被忽略", () => {
    const board = new Board();

    expect(() =>
      board.signalsEventBus.emit("input", {
        to: "/missing/sample-device",
        signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
      }),
    ).not.toThrow();
  });

  test("mountWorkflow 与 unmountWorkflow 应在运行时挂载和卸载工具节点", async () => {
    const { board, viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "main",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const tool = new CollectingTool();

      const emptyBuilder = createSubDAG("/sample-device");
      emptyBuilder.node().defaultRoute("tool");

      const scope = viewport.inputScope;
      scope.mountDevice("", emptyBuilder.build());

      const mountedNode = scope.mountWorkflow("sample-device-tool", tool);
      scope.addEdge({
        from: "sample-device",
        to: "workflows/sample-device-tool",
        name: "tool",
      });

      expect(mountedNode).not.toBeNull();
      expect(
        viewport.devicesDAG.getNode("/main/sample-device/tool"),
      ).not.toBeNull();

      board.signalsEventBus.emit("input", {
        to: "/main/sample-device",
        signals: [{ type: "position", context: { value: { x: 3, y: 4 } } }],
      });

      expect(tool.calls).toHaveLength(1);
      expect(tool.calls[0].context).toEqual(
        expect.objectContaining({
          services: expect.objectContaining({ board, viewport }),
          path: "/main/sample-device/tool",
        }),
      );

      const unmounted = scope.unmountWorkflow("sample-device-tool", [
        { from: "/sample-device", edge: "tool" },
      ]);

      expect(unmounted).toBe(true);
      expect(
        viewport.devicesDAG.getNode("/main/sample-device/tool"),
      ).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("mount 事件应支持 edge.prefix 在设备节点与 workflow 之间注入边级 prefix 链", async () => {
    const { board, viewport, cleanup } = await createWorkerBoardContext({
      boardWidth: 800,
      boardHeight: 600,
      viewportId: "main",
      viewportWidth: 800,
      viewportHeight: 600,
    });

    try {
      const keyboardDevice = createKeyboardDevice();

      const scope = viewport.inputScope;
      scope.mountDevice("", keyboardDevice);

      const receivedPackets = [];
      const workflow = {
        createProcessor: () => (packet) => {
          receivedPackets.push({ to: packet.to, signals: packet.signals });
          return [];
        },
      };

      scope.mountWorkflow("strafe-workflow", workflow);
      scope.addEdge({
        from: "keyboard/code/KeyW",
        to: "workflows/strafe-workflow",
        prefix: createEdgePrefix({
          handler(packet) {
            const signals = packet.signals
              .filter(
                (signal) =>
                  signal.type === "trigger",
              )
              .map(() => ({
                type: "position",
                context: { value: { x: 1, y: 0 }, code: "KeyW" },
              }));
            return signals.length === 0 ? [] : { signals };
          },
        }),
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
      expect(receivedPackets[0].signals[0]).toMatchObject({
        type: "position",
        context: {
          value: { x: 1, y: 0 },
          code: "KeyW",
        },
      });
    } finally {
      cleanup();
    }
  });
});
