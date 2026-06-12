import { DevicesDAG, createSubDAG } from "../../devices-dag/index.js";
import { createEdgePrefix } from "../../prefixs/index.js";
import {
  createKeyboardDevice,
  KEYBOARD_DEVICE_SIGNAL_TYPES,
} from "../keyboard-device.js";
import { CollectingTool } from "../../test-support/mock-tools.js";

function toPlainPackets(packets) {
  return packets.map((packet) => ({
    to: packet.to,
    signals: packet.signals,
  }));
}

describe("keyboard-device", () => {
  test("按键按下应更新状态，并路由到 event、keydown 与按键专属节点", () => {
    const dag = new DevicesDAG();
    const keyboardDevice = createKeyboardDevice();
    const tool = new CollectingTool();

    const mountedNodes = dag.mountSubDAG("/monitor", keyboardDevice);
    dag.mountWorkflow("/monitor/workflows/space-tool", tool);

    const prefix = createEdgePrefix({
      handler(packet) {
        const triggerSignals = packet.signals.filter(
          (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
        );
        return triggerSignals.length === 0 ? [] : { signals: triggerSignals };
      },
    });
    const prefixNodes = dag.mountSubDAG(
      "/monitor/keyboard/code/Space",
      { ...prefix, rootPath: "/default" },
      {},
    );
    dag.addEdge(
      prefixNodes[0].path,
      "default",
      "/monitor/workflows/space-tool",
    );

    const result = dag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: {
            code: "Space",
            key: " ",
            repeat: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            metaKey: false,
          },
        },
      ],
    });

    expect(keyboardDevice.getState()).toEqual({
      activeKeys: [
        {
          code: "Space",
          key: " ",
          repeat: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        },
      ],
      lastEvent: {
        type: "keydown",
        code: "Space",
        key: " ",
        repeat: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      },
    });

    expect(toPlainPackets(result.packets)).toEqual([
      {
        to: "",
        signals: [
          {
            type: "keydown",
            context: {
              code: "Space",
              key: " ",
              repeat: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              metaKey: false,
            },
          },
        ],
      },
      {
        to: "",
        signals: [
          {
            type: "keydown",
            context: {
              code: "Space",
              key: " ",
              repeat: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              metaKey: false,
            },
          },
        ],
      },
    ]);

    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0]).toEqual({
      signalPacket: {
        to: "",
        signals: [
          {
            type: KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
            context: {
              code: "Space",
              key: " ",
              repeat: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              metaKey: false,
              sourceType: "keydown",
            },
          },
        ],
      },
      context: expect.objectContaining({
        path: "/monitor/keyboard/code/Space/default/default",
      }),
    });
  });

  test("重复按键应路由到 repeat，并保留当前激活键", () => {
    const dag = new DevicesDAG();
    const keyboardDevice = createKeyboardDevice();

    dag.mountSubDAG("/monitor", keyboardDevice);

    dag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyA", key: "a", repeat: false },
        },
      ],
    });

    const result = dag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyA", key: "a", repeat: true },
        },
      ],
    });

    expect(toPlainPackets(result.packets)).toEqual([
      {
        to: "",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyA", key: "a", repeat: true },
          },
        ],
      },
      {
        to: "",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyA", key: "a", repeat: true },
          },
        ],
      },
    ]);

    expect(keyboardDevice.getState().activeKeys).toEqual([
      {
        code: "KeyA",
        key: "a",
        repeat: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      },
    ]);
  });

  test("按键抬起与取消应清理状态", () => {
    const dag = new DevicesDAG();
    const keyboardDevice = createKeyboardDevice();

    dag.mountSubDAG("/monitor", keyboardDevice);

    dag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyW", key: "w", repeat: false },
        },
        {
          type: "keydown",
          context: { code: "KeyA", key: "a", repeat: false },
        },
      ],
    });

    const keyupPackets = dag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keyup",
          context: { code: "KeyW", key: "w", repeat: false },
        },
      ],
    });

    expect(
      toPlainPackets(keyupPackets.packets)
        .map((packet) => packet.signals[0].type)
        .sort(),
    ).toEqual(["keyup", "keyup"]);

    expect(keyboardDevice.getState().activeKeys).toEqual([
      {
        code: "KeyA",
        key: "a",
        repeat: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      },
    ]);

    dag.dispatch({
      to: "/monitor/keyboard",
      signals: [{ type: "cancel", context: {} }],
    });

    expect(keyboardDevice.getState().activeKeys).toEqual([]);
  });

  test("可在按键节点把信号改写为 position 并汇流到公共工具节点", () => {
    const dag = new DevicesDAG();
    const keyboardDevice = createKeyboardDevice();
    const tool = new CollectingTool();

    const mountedNodes = dag.mountSubDAG("/monitor", keyboardDevice);
    dag.mountWorkflow("/monitor/workflows/move-tool", tool);

    // 用边级 prefix 替代旧 nodeConfigs handler
    const wasdPrefix = (code, vector) =>
      createEdgePrefix({
        handler(packet) {
          const signals = packet.signals
            .filter(
              (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
            )
            .map((signal) => ({
              type: "position",
              context: {
                value: { ...vector },
                code,
                sourceType: signal.type,
              },
            }));
          return signals.length === 0 ? [] : { signals };
        },
      });

    for (const [code, vector] of [
      ["KeyW", { x: 0, y: -1 }],
      ["KeyD", { x: 1, y: 0 }],
    ]) {
      const prefix = wasdPrefix(code, vector);
      const prefixNodes = dag.mountSubDAG(
        `/monitor/keyboard/code/${code}`,
        { ...prefix, rootPath: "/default" },
        {},
      );
      dag.addEdge(
        prefixNodes[0].path,
        "default",
        "/monitor/workflows/move-tool",
      );
    }

    const result = dag.dispatch({
      to: "/monitor/keyboard",
      signals: [
        {
          type: "keydown",
          context: { code: "KeyW", key: "w", repeat: false },
        },
        {
          type: "keydown",
          context: { code: "KeyD", key: "d", repeat: false },
        },
      ],
    });

    expect(toPlainPackets(result.packets)).toEqual([
      {
        to: "",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyW", key: "w", repeat: false },
          },
          {
            type: "keydown",
            context: { code: "KeyD", key: "d", repeat: false },
          },
        ],
      },
      {
        to: "",
        signals: [
          {
            type: "keydown",
            context: { code: "KeyW", key: "w", repeat: false },
          },
          {
            type: "keydown",
            context: { code: "KeyD", key: "d", repeat: false },
          },
        ],
      },
    ]);

    expect(tool.calls).toHaveLength(2);
    expect(tool.calls[0].signalPacket).toEqual({
      to: "",
      signals: [
        {
          type: "position",
          context: {
            value: { x: 0, y: -1 },
            code: "KeyW",
            sourceType: "trigger",
          },
        },
      ],
    });
    expect(tool.calls[1].signalPacket).toEqual({
      to: "",
      signals: [
        {
          type: "position",
          context: {
            value: { x: 1, y: 0 },
            code: "KeyD",
            sourceType: "trigger",
          },
        },
      ],
    });
  });
});
